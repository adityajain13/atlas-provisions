// T&T's storefront item, normalised: the final and regular prices, sale detection, weight-priced products, stock, and
// the items that are dropped. Pure: no network.
import { describe, expect, it } from 'vitest';
import { normaliseTntItem } from './tnt';

/** An item the way the storefront sends it: the regular price, the final price, and the was price when there is one. */
function item(over: Record<string, unknown> & { name: string }) {
  return {
    id: 1,
    sku: 'SKU1',
    stock_status: 'IN_STOCK',
    price: { regularPrice: { amount: { currency: 'CAD', value: 3.49 } } },
    price_range: { minimum_price: { final_price: { currency: 'CAD', value: 3.49 } } },
    was_price: null,
    uom_type: null,
    weight_uom: null,
    ...over,
  };
}

describe('normaliseTntItem', () => {
  it('reads the final price and the regular price, and a sale when the final is below the regular', () => {
    const got = normaliseTntItem(
      item({
        name: 'Firm Tofu 454g',
        sku: 'TOFU1',
        price: { regularPrice: { amount: { value: 3.49 } } },
        price_range: { minimum_price: { final_price: { value: 2.99 } } },
      }),
    );
    expect(got).toEqual({ sku: 'TOFU1', name: 'Firm Tofu 454g', price: 2.99, regularPrice: 3.49, onSale: true, inStock: true });
  });

  it('takes the was price as the regular price when it is higher', () => {
    const got = normaliseTntItem(
      item({
        name: 'Tofu 340g',
        price_range: { minimum_price: { final_price: { value: 3.99 } } },
        was_price: 4.99,
      }),
    );
    expect(got).toMatchObject({ price: 3.99, regularPrice: 4.99, wasPrice: 4.99, onSale: true });
  });

  it('is not on sale when the final and the regular prices are the same', () => {
    expect(normaliseTntItem(item({ name: 'Tofu 340g' }))).toMatchObject({ price: 3.49, regularPrice: 3.49, onSale: false });
  });

  it('reads a product priced by the pound or the kilogram as weight-priced', () => {
    expect(normaliseTntItem(item({ name: 'Ground Beef', uom_type: 'WEIGHT', weight_uom: 'LB' }))).toMatchObject({ perWeight: 'lb' });
    expect(normaliseTntItem(item({ name: 'Bok Choy', uom_type: 'weight', weight_uom: 'KG' }))).toMatchObject({ perWeight: 'kg' });
    expect(normaliseTntItem(item({ name: 'Tofu 340g', uom_type: 'EACH' }))).not.toHaveProperty('perWeight');
  });

  it('marks an out-of-stock product', () => {
    expect(normaliseTntItem(item({ name: 'Tofu 340g', stock_status: 'OUT_OF_STOCK' }))).toMatchObject({ inStock: false });
  });

  it('drops a product with no name or no price', () => {
    expect(normaliseTntItem(item({ name: '' }))).toBeNull();
    expect(normaliseTntItem({ name: 'Tofu', price: null, price_range: null })).toBeNull();
    expect(normaliseTntItem(item({ name: 'Free Tofu', price_range: { minimum_price: { final_price: { value: 0 } } } }))).toBeNull();
    expect(normaliseTntItem('tofu')).toBeNull();
  });
});
