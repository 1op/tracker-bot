const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');

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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const order of orders) {
      try {
        console.log(`🔍 جاري فحص الطلب #${order.id} عبر الرابط: ${order.original_link}`);
        
        await page.goto(order.original_link, { waitUntil: 'networkidle2', timeout: 30000 });

        // 4. البحث عن النسبة المئوية الذكية
        const extractedProgress = await page.evaluate(() => {
          const bodyText = document.body.innerText;
          const matches = bodyText.match(/(\d+)\s*%/g);
          if (!matches) return null;

          const numbers = matches
            .map(m => parseInt(m.replace('%', '').trim(), 10))
            .filter(n => !isNaN(n));

          if (numbers.length === 0) return null;

          const nonZero = numbers.filter(n => n > 0);
          return nonZero.length > 0 ? Math.max(...nonZero) : numbers[0];
        });

        const currentProgressInDb = order.progress || 0;

        console.log(`📊 النسبة المقروءة: ${extractedProgress !== null ? extractedProgress + '%' : 'غير متوفرة'} | النسبة الحالية بالداتابيز: ${currentProgressInDb}%`);

        // 5. جدار الحماية ضد التصفير (Daily Limit Guard)
        if (extractedProgress === null) {
          console.log(`⚠️ تعذر استخراج النسبة للطلب #${order.id}. تم إلغاء التحديث للحفاظ على النسبة الحالية.`);
          continue;
        }

        if (extractedProgress === 0 && currentProgressInDb > 0) {
          console.log(`🛡️ جدار الحماية: تم إلغاء التصفير للطلب #${order.id} لأن النسبة المقروءة (0%) تتعارض مع النسبة المسجلة سابقاً (${currentProgressInDb}%).`);
          continue;
        }

        // تحديث النسبة فقط إذا اختلفت
        if (extractedProgress === currentProgressInDb) {
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
