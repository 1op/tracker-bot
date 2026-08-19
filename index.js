import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

// 1. إعداد الاتصال بـ Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function syncTrackerData() {
  console.log(`[${new Date().toISOString()}] 🔄 بدء فحص الطلبات النشطة...`);

  try {
    // 2. جلب الطلبات التي بحالة PROCESSING ولديها رابط
    const { data: orders, error } = await supabase
      .from('Tire_One')
      .select('id, original_link, progress')
      .eq('status', 'PROCESSING')
      .not('original_link', 'is', null);

    if (error) throw error;

    if (!orders || orders.length === 0) {
      console.log('ℹ️ لا توجد طلبات نشطة حالياً بحاجة للمزامنة.');
      return;
    }

    console.log(`📌 تم العثور على ${orders.length} طلب/طلبات للمزامنة.`);

    // 3. تشغيل المتصفح (Puppeteer)
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    // ضبط User-Agent لتفادي الحظر
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const order of orders) {
      try {
        console.log(`🔍 جاري فحص الطلب #${order.id} عبر الرابط: ${order.original_link}`);
        
        await page.goto(order.original_link, { waitUntil: 'networkidle2', timeout: 30000 });

        // 4. استخراج النسبة المئوية مرناً
        const extractedProgress = await page.evaluate(() => {
          const text = document.body.innerText;
          const match = text.match(/(\d+)\s*%/);
          return match ? parseInt(match[1], 10) : null;
        });

        console.log(`📊 النسبة المقروءة للطلب #${order.id}: ${extractedProgress !== null ? extractedProgress + '%' : 'غير معروفة'}`);

        // 5. شرط الحماية: لا نحدّث إذا كانت القيمة null أو 0 والموجود سابقاً أكبر من 0
        if (extractedProgress !== null && extractedProgress > 0) {
          if (order.progress === extractedProgress) {
            console.log(`ℹ️ لا يوجد تغيير، النسبة الحالية (${extractedProgress}%) مطابقة مع Supabase.`);
          } else {
            const { error: updateError } = await supabase
              .from('Tire_One')
              .update({ progress: extractedProgress })
              .eq('id', order.id);

            if (updateError) {
              console.error(`❌ خطأ أثناء تحديث الطلب #${order.id}:`, updateError.message);
            } else {
              console.log(`✅ تم تحديث الطلب #${order.id} بنجاح إلى ${extractedProgress}%`);
            }
          }
        } else {
          console.log(`⚠️ تم تجاوز تحديث الطلب #${order.id} لحماية البيانات (النسبة المقروءة 0% أو غير متوفرة بسبب صفحة الـ Daily Limit/الصورة).`);
        }

      } catch (orderError) {
        console.error(`❌ حدث خطأ أثناء معالجة الطلب #${order.id}:`, orderError.message);
      }
    }

    await browser.close();
    console.log('✨ اكتملت عملية المزامنة بنجاح.');

  } catch (err) {
    console.error('❌ خطأ عام في Supabase أو السكربت:', err);
  }
}

syncTrackerData();
