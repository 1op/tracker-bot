const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');

puppeteer.use(StealthPlugin());

const SUPABASE_URL = "https://eplnmlsegvwqcyneebbf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_j34IvrzngwK00_O1Nz8vvw_92CJLGSh";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkAndSyncOrders() {
  console.log(`[${new Date().toISOString()}] 🔄 بدء فحص الطلبات النشطة...`);

  try {
    // جلب الطلبات قيد المعالجة والتي تحتوي على رابط في original_link
    const { data: orders, error } = await supabase
      .from('Tire_One')
      .select('*')
      .eq('status', 'PROCESSING')
      .not('original_link', 'is', null);

    if (error) {
      console.error("❌ خطأ Supabase:", error);
      return;
    }

    if (!orders || orders.length === 0) {
      console.log("ℹ️ لا توجد طلبات جديدة بحاجة للمزامنة حالياً.");
      return;
    }

    console.log(`📌 تم العثور على ${orders.length} طلب/طلبات للمزامنة.`);

    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    for (const order of orders) {
      const trackingUrl = order.original_link ? order.original_link.trim() : "";
      if (!trackingUrl || !trackingUrl.startsWith("http")) {
        console.warn(`⚠️ رابط غير صالح للطلب #${order.order_id}: "${trackingUrl}"`);
        continue;
      }

      console.log(`🔍 جاري فحص الطلب #${order.order_id} عبر الرابط: ${trackingUrl}`);

      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        await page.goto(trackingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 8000));

        const progress = await page.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : "";
          
          const matches = bodyText.match(/(\d{1,3})\s*%/g);
          if (matches && matches.length > 0) {
            for (let m of matches) {
              const val = parseInt(m.replace('%', '').trim());
              if (!isNaN(val) && val >= 0 && val <= 100) return val;
            }
          }

          const elements = document.querySelectorAll('span, div, p, h1, h2, h3, strong');
          for (let el of elements) {
            if (el.children.length === 0 && el.innerText) {
              const txt = el.innerText.trim();
              if (txt.includes('%')) {
                const num = parseInt(txt.replace(/[^0-9]/g, ''));
                if (!isNaN(num) && num >= 0 && num <= 100) return num;
              }
            }
          }

          return null;
        });

        console.log(`📊 النسبة المقروءة للطلب #${order.order_id}: ${progress !== null ? progress + '%' : 'لم يتم العثور على نسبة'}`);

        if (progress !== null && progress !== order.progress) {
          const newStatus = progress >= 100 ? "COMPLETED" : "PROCESSING";
          
          const { error: updateErr } = await supabase
            .from('Tire_One')
            .update({ progress: progress, status: newStatus })
            .eq('order_id', order.order_id);

          if (updateErr) {
            console.error(`❌ فشل التحديث في Supabase للطلب #${order.order_id}:`, updateErr.message);
          } else {
            console.log(`✅ تم تحديث الطلب #${order.order_id} بنجاح إلى ${progress}%`);
          }
        } else if (progress === order.progress) {
          console.log(`ℹ️ النسبة الحالية (${progress}%) متطابقة مع Supabase، لا يوجد تغيير.`);
        }

        await page.close();
      } catch (err) {
        console.error(`❌ خطأ أثناء معالجة الطلب #${order.order_id}:`, err.message);
      }
    }

    await browser.close();
  } catch (err) {
    console.error("❌ خطأ رئيسي:", err);
  }
}

checkAndSyncOrders();
