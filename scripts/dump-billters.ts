import { getBillCategories } from "../src/lib/flutterwave";

getBillCategories().then((items: any[]) => {
  for (const i of items) {
    if (i.is_airtime) continue;
    console.log(i.biller_code, "|", i.item_code, "|", i.biller_name ?? i.name, "|", i.short_name);
  }
});