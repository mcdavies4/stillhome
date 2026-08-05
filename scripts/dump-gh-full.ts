const KEY = process.env.FLW_SECRET_KEY;
async function run(country){
  const res = await fetch(`https://api.flutterwave.com/v3/bill-categories?country=${country}`,{headers:{Authorization:`Bearer ${KEY}`}});
  const data = await res.json();
  if(data.status!=="success"){ console.error(country, data.message); return; }
  const seen = new Set();
  for(const i of data.data){
    const k = i.biller_code+"|"+i.item_code;
    if(seen.has(k)) continue; seen.add(k);
    console.log(`${i.biller_code} | ${i.item_code} | ${(i.biller_name||i.name||"").trim()} | ${(i.short_name||"").trim()} | airtime=${!!i.is_airtime} | amt=${i.amount||""}`);
  }
}
run("GH");
