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
    // جلب الأوردرات اللي حالتها PROCESSING ولديها رابط تتبع
    const { data: orders, error } = await supabase
      .from('Tire_One')
      .select('*')
      .eq('status', 'PROCESSING')
      .not('tracker_url', 'is', null);

    if (error) {
      console.error("❌ خطأ Supabase:", error);
      return;
    }

    if (!orders || orders.length === 0) {
      console.log("ℹ️ لا توجد طلبات جديدة بحاجة للمزامنة حالياً.");
      return;
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const order of orders) {
      const trackingUrl = order.tracker_url;
      if (!trackingUrl) continue;

      try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.goto(trackingUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        await new Promise(r => setTimeout(r, 4000));

        const progress = await page.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : "";
          const matches = bodyText.match(/(\d{1,3})\s*%/g);
          if (matches && matches.length > 0) {
            for (let m of matches) {
              const val = parseInt(m.replace('%', '').trim());
              if (!isNaN(val) && val >= 0 && val <= 100) return val;
            }
          }
          return null;
        });

        if (progress !== null && progress !== order.progress) {
          const newStatus = progress >= 100 ? "COMPLETED" : "PROCESSING";
          
          await supabase
            .from('Tire_One')
            .update({ progress: progress, status: newStatus })
            .eq('order_id', order.order_id);

          console.log(`✅ تم تحديث الطلب #${order.order_id} إلى ${progress}%`);
        }

        await page.close();
      } catch (err) {
        console.error(`❌ خطأ في الطلب #${order.order_id}:`, err.message);
      }
    }

    await browser.close();
  } catch (err) {
    console.error("❌ خطأ عام:", err);
  }
}

checkAndSyncOrders();
