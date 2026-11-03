import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { eyebrow } from '../components/ui';
import { CATEGORY_ORDER, MOCK_LIST } from '../mocks/week';

const STORAGE_KEY = `provisions:list:${MOCK_LIST.weekOf}`;

function readChecked(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export default function List() {
  const [checked, setChecked] = useState<Set<string>>(readChecked);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...checked]));
    } catch {
      // Storage unavailable (private window or blocked). The list still works in memory.
    }
  }, [checked]);

  const items = MOCK_LIST.items;
  const total = items.reduce((sum, i) => sum + i.price, 0);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Page>
      <Header
        subtitle={`${MOCK_LIST.stores.length} stores · ${items.length} items · $${total.toFixed(2)}`}
        title="Shopping list"
      />

      {MOCK_LIST.stores.map((store) => {
        const storeItems = items.filter((i) => i.store === store);
        const subtotal = storeItems.reduce((sum, i) => sum + i.price, 0);
        return (
          <section key={store} className="mt-10 border-t border-line pt-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-[24px] font-normal text-paper">{store}</h2>
              <span className="text-[14px] text-muted">${subtotal.toFixed(2)}</span>
            </div>

            {CATEGORY_ORDER.map((category) => {
              const rows = storeItems.filter((i) => i.category === category);
              if (rows.length === 0) return null;
              return (
                <div key={category} className="mt-6">
                  <p className={eyebrow}>{category}</p>
                  <ul className="mt-2">
                    {rows.map((item) => {
                      const done = checked.has(item.id);
                      return (
                        <li key={item.id}>
                          <label className="flex min-h-[56px] items-center gap-3 border-b border-line2 py-2">
                            <input
                              type="checkbox"
                              className="h-5 w-5 shrink-0"
                              checked={done}
                              onChange={() => toggle(item.id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block text-[15px] ${
                                  done ? 'text-faint line-through' : 'text-paper'
                                }`}
                              >
                                {item.name}
                                <span className="ml-2 text-[13px] text-muted">{item.qty}</span>
                              </span>
                              {item.note && (
                                <span
                                  className={`block text-[12px] ${
                                    item.note.kind === 'match' ? 'text-herbLight' : 'text-muted'
                                  }`}
                                >
                                  {item.note.text}
                                </span>
                              )}
                            </span>
                            <span
                              className={`shrink-0 text-[14px] ${done ? 'text-faint' : 'text-paper'}`}
                            >
                              ${item.price.toFixed(2)}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </Page>
  );
}
