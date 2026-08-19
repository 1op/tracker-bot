const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');

puppeteer.use(StealthPlugin());

// بيانات Supabase الخاصة بك
const SUPABASE_URL = "https://eplnmlsegvwqcyneebbf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_j34IvrzngwK00_O1Nz8vvw_92CJLGSh";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// وقت الفحص بالمللي ثانية (مثلاً كل 3 دقائق = 180000 مللي ثانية)
const CHECK_INTERVAL = 3 * 60 * 1000;

async function checkAndSyncOrders() {
  console.log(`[${new Date().toISOString()}] 🔄 بدء فحص الطلبات النشطة...`);

  try {
    // 1. جلب الطلبات قيد التعيين/المعالجة من Supabase التي تحتوي على رابط تتبع
    const { data: orders, error } = await supabase
      .from('Tire_One')
      .select('*')
      .eq('status', 'PROCESSING');

    if (error) {
      console.error("❌ خطأ في جلب الطلبات من Supabase:", error);
      return;
    }

    if (!orders || orders.length === 0) {
      console.log("ℹ️ لا توجد طلبات نشطة بحاجة للمزامنة حالياً.");
      return;
    }

    // 2. تشغيل متصفح خفي (Headless Browser)
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
      ]
    });

    for (const order of orders) {
      // تأكد أن جدول Tire_One يحتوي على العمود الذي يحفظ رابط التتبع (مثلاً tracker_url)
      const trackingUrl = order.tracker_url; 
      if (!trackingUrl) continue;

      try {
        const page = await browser.newPage();
        
        // إعدادات لتجنب كشف البوت
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto(trackingUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // انتظام بسيط للتأكد من تحميل الصفحة وتخطي الحماية
        await new Promise(r => setTimeout(r, 5000));

        // قراءة النسبة المئوية من الصفحة
        const progress = await page.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : "";
          const matches = bodyText.match(/(\d{1,3})\s*%/g);
          if (matches && matches.length > 0) {
            for (let m of matches) {
              const val = parseInt(m.replace('%', '').trim());
              if (!isNaN(val) && val >= 0 && val <= 100) {
                return val;
              }
            }
          }
          return null;
        });

        if (progress !== null && progress !== order.progress) {
          // تحديث النسبة في Supabase
          const newStatus = progress >= 100 ? "COMPLETED" : "PROCESSING";
          
          await supabase
            .from('Tire_One')
            .update({ progress: progress, status: newStatus })
            .eq('order_id', order.order_id);

          console.log(`✅ تم تحديث الطلب #${order.order_id} إلى نسبة ${progress}%`);
        }

        await page.close();
      } catch (err) {
        console.error(`❌ خطأ أثناء فحص الطلب #${order.order_id}:`, err.message);
      }
    }

    await browser.close();
  } catch (err) {
    console.error("❌ خطأ عام في المزامنة:", err);
  }
}

// تشغيل الفحص فوراً عند قيام السيرفر
checkAndSyncOrders();

// إعداد التكرار الدوري
setInterval(checkAndSyncOrders, CHECK_INTERVAL);