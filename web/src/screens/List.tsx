import { useEffect, useState } from 'react';
import { planWeekOf, type MealPlan } from '@provisions/shared';
import { errorMessage, getPlan } from '../api';
import { Header } from '../components/Header';
import { NoPlan } from '../components/NoPlan';
import { Page } from '../components/Page';
import { SaveStatus, useSaveScope } from '../components/SaveStatus';
import { eyebrow } from '../components/ui';
import { useChecks } from '../lib/useChecks';
import { LIST_CATEGORY_ORDER, planToList, type ViewItem } from '../lib/planView';

type View = { weekOf: string; stores: string[]; items: ViewItem[] };

type State =
  | { status: 'loading' }
  | { status: 'plan'; view: View }
  | { status: 'none' }
  | { status: 'error'; error: string };

export default function List() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    getPlan(planWeekOf(new Date()))
      .then((plan: MealPlan | null) => {
        if (!alive) return;
        setState(plan ? { status: 'plan', view: planToList(plan) } : { status: 'none' });
      })
      .catch((e: unknown) => {
        if (alive) setState({ status: 'error', error: errorMessage(e) });
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

  if (state.status === 'none') {
    return (
      <Page>
        <Header title="Shopping list" />
        <NoPlan />
      </Page>
    );
  }

  if (state.status === 'error') {
    return (
      <Page>
        <Header title="Shopping list" />
        <p className="mt-10 text-[14px] text-muted">Could not load this week&apos;s plan: {state.error}</p>
      </Page>
    );
  }

  // Mounted only once the view is known, so the checked state comes from this week's key.
  return <ListBody view={state.view} />;
}

function ListBody({ view }: { view: View }) {
  const { checks, toggle, ready } = useChecks(view.weekOf);
  useSaveScope('sync', ready);

  const items = view.items;
  // Only real stores get a column. Items no store sells are listed separately, without a price.
  const stores = view.stores.filter((s) => s !== 'Unpriced');
  const unpriced = items.filter((i) => i.store === 'Unpriced');
  const total = items.reduce((sum, i) => sum + i.price, 0);

  return (
    <Page>
      <Header
        subtitle={`${stores.length} stores · ${items.length} items · $${total.toFixed(2)}`}
        title="Shopping list"
        status={<SaveStatus />}
      />
      <p className="mt-2 text-[12px] text-muted">Shared with everyone in your household.</p>

      {items.length === 0 && <p className="mt-10 text-[14px] text-muted">Nothing to buy.</p>}

      <div
        className={`lg:mt-12 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:gap-y-12 xl:grid-cols-3 ${
          stores.length >= 4 ? '2xl:grid-cols-4' : ''
        }`}
      >
      {stores.map((store) => {
        const storeItems = items.filter((i) => i.store === store);
        const subtotal = storeItems.reduce((sum, i) => sum + i.price, 0);
        return (
          <section key={store} className="mt-10 border-t border-line pt-4 lg:mt-0">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display font-semibold tracking-[-0.01em] text-paper text-[24px]">{store}</h2>
              <span className="text-[14px] text-muted">${subtotal.toFixed(2)}</span>
            </div>

            {LIST_CATEGORY_ORDER.map((category) => {
              const rows = storeItems.filter((i) => i.category === category);
              if (rows.length === 0) return null;
              return (
                <div key={category} className="mt-6">
                  <p className={eyebrow}>{category}</p>
                  <ul className="mt-2">
                    {rows.map((item) => (
                      <ListRow key={item.id} item={item} done={checks.list[item.id] === true} onToggle={() => toggle('list', item.id)} showPrice />
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
          <h2 className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px]">Not in this week&apos;s flyers</h2>
          <p className="mt-1 text-[13px] text-muted">{"Buy anywhere; prices weren't in this week's flyers."}</p>
          <ul className="mt-4">
            {unpriced.map((item) => (
              <ListRow key={item.id} item={item} done={checks.list[item.id] === true} onToggle={() => toggle('list', item.id)} showPrice={false} />
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
  item: ViewItem;
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
          {item.elsewhere && <span className="block text-[12px] text-muted">{item.elsewhere}</span>}
        </span>
        {showPrice && (
          <span className={`shrink-0 text-[14px] ${done ? 'text-faint' : 'text-paper'}`}>${item.price.toFixed(2)}</span>
        )}
      </label>
    </li>
  );
}
