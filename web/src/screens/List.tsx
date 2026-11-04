import { useEffect, useState } from 'react';
import { flyerWeekOf, type MealPlan } from '@provisions/shared';
import { errorMessage, getPlan } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { SamplePill } from '../components/SamplePill';
import { eyebrow } from '../components/ui';
import { planToList } from '../lib/planView';
import { CATEGORY_ORDER, MOCK_LIST, type MockItem } from '../mocks/week';

type View = { weekOf: string; stores: string[]; items: MockItem[] };

function readChecked(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export default function List() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; view: View; plan: boolean; error: string | null }>({
    status: 'loading',
  });

  useEffect(() => {
    let alive = true;
    getPlan(flyerWeekOf(new Date()))
      .then((plan: MealPlan | null) => {
        if (!alive) return;
        setState(
          plan
            ? { status: 'ready', view: planToList(plan), plan: true, error: null }
            : { status: 'ready', view: { weekOf: MOCK_LIST.weekOf, stores: MOCK_LIST.stores, items: MOCK_LIST.items }, plan: false, error: null },
        );
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({
          status: 'ready',
          view: { weekOf: MOCK_LIST.weekOf, stores: MOCK_LIST.stores, items: MOCK_LIST.items },
          plan: false,
          error: errorMessage(e),
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <Page>
        <Header title="Shopping list" />
        <p className="mt-10 text-[14px] text-muted">Loading&hellip;</p>
      </Page>
    );
  }

  // Mounted only once the view is known, so the checked state comes from this week's key.
  return <ListBody view={state.view} plan={state.plan} error={state.error} />;
}

function ListBody({ view, plan, error }: { view: View; plan: boolean; error: string | null }) {
  const storageKey = `provisions:list:${view.weekOf}`;
  const [checked, setChecked] = useState<Set<string>>(() => readChecked(storageKey));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...checked]));
    } catch {
      // Storage unavailable (private window or blocked). The list still works in memory.
    }
  }, [checked, storageKey]);

  const items = view.items;
  // Only real stores get a column. Items no store sells are listed separately, without a price.
  const stores = view.stores.filter((s) => s !== 'Unpriced');
  const unpriced = items.filter((i) => i.store === 'Unpriced');
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
        subtitle={
          <>
            {`${stores.length} stores · ${items.length} items · $${total.toFixed(2)}`}
            {!plan && <SamplePill />}
          </>
        }
        title="Shopping list"
      />

      {error && <p className="mt-6 text-[13px] text-muted">Could not load this week's plan: {error}</p>}
      {plan && items.length === 0 && <p className="mt-10 text-[14px] text-muted">Nothing to buy.</p>}

      <div className="lg:mt-12 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:gap-y-12 xl:grid-cols-3">
      {stores.map((store) => {
        const storeItems = items.filter((i) => i.store === store);
        const subtotal = storeItems.reduce((sum, i) => sum + i.price, 0);
        return (
          <section key={store} className="mt-10 border-t border-line pt-4 lg:mt-0">
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
                    {rows.map((item) => (
                      <ListRow key={item.id} item={item} done={checked.has(item.id)} onToggle={() => toggle(item.id)} showPrice />
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
      </div>

      {unpriced.length > 0 && (
        <section className="mt-12 border-t border-line pt-4">
          <h2 className="font-display text-[20px] font-normal text-paper">Not in this week&apos;s flyers</h2>
          <p className="mt-1 text-[13px] text-muted">{"Buy anywhere; prices weren't in this week's flyers."}</p>
          <ul className="mt-4">
            {unpriced.map((item) => (
              <ListRow key={item.id} item={item} done={checked.has(item.id)} onToggle={() => toggle(item.id)} showPrice={false} />
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}

function ListRow({
  item,
  done,
  onToggle,
  showPrice,
}: {
  item: MockItem;
  done: boolean;
  onToggle: () => void;
  showPrice: boolean;
}) {
  return (
    <li>
      <label className="flex min-h-[56px] items-center gap-3 border-b border-line2 py-2">
        <input type="checkbox" className="h-5 w-5 shrink-0" checked={done} onChange={onToggle} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] ${done ? 'text-faint line-through' : 'text-paper'}`}>
            {item.name}
            {item.qty && <span className="ml-2 text-[13px] text-muted">{item.qty}</span>}
          </span>
          {item.note && (
            <span className={`block text-[12px] ${item.note.kind === 'match' ? 'text-herbLight' : 'text-muted'}`}>
              {item.note.text}
            </span>
          )}
        </span>
        {showPrice && (
          <span className={`shrink-0 text-[14px] ${done ? 'text-faint' : 'text-paper'}`}>${item.price.toFixed(2)}</span>
        )}
      </label>
    </li>
  );
}
