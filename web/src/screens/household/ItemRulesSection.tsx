import { Fragment, useState } from 'react';
import { type CatalogIngredient, newId, type Household, type ItemRule } from '@provisions/shared';
import { IngredientPicker } from '../../components/IngredientPicker';
import { Svg } from '../../components/Icons';
import {
  EMPTY_EXPANSION_TEXT,
  NO_MATCH_TEXT,
  alwaysMatchName,
  exceptAfter,
  neverChipLabel,
  neverExpansion,
} from '../../lib/itemRules';
import { Section } from '../../components/Section';
import { addBtn, chipBase, eyebrow, fieldCls, linkBtn, removeIconBtn } from '../../components/ui';
import { pinStoreOptions, withPinnedStore } from '../../lib/stores';

import { type Update, ERROR_TEXT } from './ui';

// ---------- Always / never buy ----------

export function ItemRulesSection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Always / never buy">
      <RuleList title="Always buy" rule="always" h={h} update={update} />
      <div className="mt-6">
        <PinList h={h} update={update} />
      </div>
      <div className="mt-6">
        <RuleList title="Never buy" rule="never" h={h} update={update} />
      </div>
    </Section>
  );
}

/** A store select for one rule: "Cheapest", or a store. A store that is turned off stays visible, marked off. */
function StoreSelect({
  label,
  value,
  stores,
  cheapestLabel,
  onChange,
}: {
  label: string;
  value: string | undefined;
  stores: string[];
  cheapestLabel?: string;
  onChange: (store: string | undefined) => void;
}) {
  const off = value !== undefined && !stores.includes(value);
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="h-9 w-[9.5rem] max-w-[11rem] rounded-md border border-edge bg-ink px-2 text-[13px] text-paper"
    >
      {cheapestLabel !== undefined && <option value="">{cheapestLabel}</option>}
      {stores.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
      {off && <option value={value}>{value} (off)</option>}
    </select>
  );
}

/** Items bought at one store whenever they are on the list: "eggs → Costco". Adding one picks the ingredient and the store. */
function PinList({ h, update }: { h: Household; update: Update }) {
  const pins = h.itemRules.filter((r) => r.rule === 'pin');
  const stores = pinStoreOptions(h.stores);
  const [picked, setPicked] = useState<CatalogIngredient | null>(null);
  const [store, setStore] = useState('');
  const chosen = stores.includes(store) ? store : (stores[0] ?? '');

  function setPinStore(id: string, name: string | undefined) {
    update((prev) => ({ ...prev, itemRules: prev.itemRules.map((r) => (r.id === id ? withPinnedStore(r, name) : r)) }));
  }

  function removePin(id: string) {
    update((prev) => ({ ...prev, itemRules: prev.itemRules.filter((r) => r.id !== id) }));
  }

  function addPin() {
    if (!picked || !chosen) return;
    const ingredient = picked;
    setPicked(null);
    update((prev) => {
      const existing = prev.itemRules.find((r) => r.rule === 'pin' && r.ingredientId === ingredient.id);
      if (existing) {
        return { ...prev, itemRules: prev.itemRules.map((r) => (r === existing ? withPinnedStore(r, chosen) : r)) };
      }
      return {
        ...prev,
        itemRules: [...prev.itemRules, { id: newId(), name: ingredient.name, rule: 'pin', store: chosen, ingredientId: ingredient.id }],
      };
    });
  }

  return (
    <div>
      <p className={eyebrow}>Always buy at a store</p>
      <p className="mt-1 text-[13px] text-muted">
        Bought at that store whenever it is on the list. It does not put the item on the list.
      </p>
      {pins.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pins.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-[15px] text-paper">
              <span className="min-w-0 truncate">{p.name}</span>
              <span className="text-muted" aria-hidden="true">
                &rarr;
              </span>
              <StoreSelect
                label={`Buy ${p.name} at`}
                value={p.store}
                stores={stores}
                onChange={(name) => setPinStore(p.id, name)}
              />
              <button
                type="button"
                aria-label={`Remove ${p.name} pin`}
                onClick={() => removePin(p.id)}
                className={removeIconBtn}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        {picked ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${chipBase} border-edge px-4 text-paper`}>{picked.name}</span>
            <StoreSelect label="Store to buy it at" value={chosen || undefined} stores={stores} onChange={(name) => setStore(name ?? '')} />
            <button type="button" onClick={addPin} disabled={!chosen} className={addBtn}>
              Add
            </button>
            <button type="button" onClick={() => setPicked(null)} className={linkBtn}>
              Change
            </button>
          </div>
        ) : (
          <IngredientPicker onPick={setPicked} />
        )}
        {stores.length === 0 && <p className="mt-2 text-[13px] text-muted">Turn on a store above to pin items to it.</p>}
      </div>
    </div>
  );
}

/** The rule with its except list replaced. An empty list is left off, so the stored rule stays as it was. */
function withExcept(rule: ItemRule, except: string[] | undefined): ItemRule {
  const next: ItemRule = { id: rule.id, name: rule.name, rule: rule.rule };
  if (except) next.except = except;
  return next;
}

function RuleList({
  title,
  rule,
  h,
  update,
}: {
  title: string;
  rule: ItemRule['rule'];
  h: Household;
  update: Update;
}) {
  const [text, setText] = useState('');
  // Never-buy names open one at a time, to show the ingredients they cover.
  const [openId, setOpenId] = useState<string | null>(null);
  const items = h.itemRules.filter((r) => r.rule === rule);

  function removeRule(id: string) {
    update((prev) => ({ ...prev, itemRules: prev.itemRules.filter((r) => r.id !== id) }));
  }

  function add() {
    const name = text.trim();
    setText('');
    if (!name) return;
    update((prev) => {
      if (prev.itemRules.some((r) => r.name.toLowerCase() === name.toLowerCase())) return prev;
      return { ...prev, itemRules: [...prev.itemRules, { id: newId(), name, rule }] };
    });
  }

  return (
    <div>
      <p className={eyebrow}>{title}</p>
      {rule === 'never' ? (
        // Chips wrap side by side. An open chip's panel is a full-width item right after it, so it sits on its own line.
        <ul className="mt-2 flex flex-wrap items-start gap-2">
          {items.map((item) => {
            const expansion = neverExpansion(item);
            const blocked = expansion.filter((e) => e.blocked).length;
            const isOpen = openId === item.id;
            const panelId = `never-panel-${item.id}`;
            return (
              <Fragment key={item.id}>
                <li>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenId(isOpen ? null : item.id)}
                    className={`${chipBase} gap-1.5 border-edge pl-4 pr-3 text-paper transition-colors hover:border-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb`}
                  >
                    {neverChipLabel(item.name, blocked)}
                    <span
                      className={`flex shrink-0 text-muted transition-transform duration-200 ease-out motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
                    >
                      <Svg size={16}>
                        <path d="M6 9l6 6 6-6" />
                      </Svg>
                    </span>
                  </button>
                </li>
                {isOpen && (
                  <li
                    id={panelId}
                    role="region"
                    aria-label={`Ingredients ${item.name} covers`}
                    className="basis-full rounded-lg border border-line2 bg-field/60 p-3"
                  >
                    {expansion.length === 0 ? (
                      <p className="text-[13px] text-muted">{EMPTY_EXPANSION_TEXT}</p>
                    ) : (
                      <>
                        <p className="mb-1 text-[12px] text-muted">Ticked ingredients are blocked. Untick one to allow it.</p>
                        <ul>
                          {expansion.map((e) => (
                            <li key={e.id}>
                              <label className="flex min-h-11 items-center gap-3 text-[15px] text-paper">
                                <input
                                  type="checkbox"
                                  checked={e.blocked}
                                  onChange={(ev) => {
                                    const nowBlocked = ev.target.checked;
                                    update((prev) => ({
                                      ...prev,
                                      itemRules: prev.itemRules.map((r) =>
                                        r.id === item.id ? withExcept(r, exceptAfter(r.except, e.id, nowBlocked)) : r,
                                      ),
                                    }));
                                  }}
                                  className="h-5 w-5 accent-herb"
                                />
                                {e.name}
                              </label>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenId(null);
                          removeRule(item.id);
                        }}
                        className="min-h-11 text-[14px] text-[#D98C7A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
                      >
                        Remove {item.name}
                      </button>
                    </div>
                  </li>
                )}
              </Fragment>
            );
          })}
        </ul>
      ) : (
        // Always-buy rows: name and match on the left, store select and remove on the right. One per line.
        <ul className="mt-2 grid gap-2">
          {items.map((item) => {
            const matched = alwaysMatchName(item.name);
            return (
              <li
                key={item.id}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-edge py-1 pl-3 pr-1 text-[14px] text-paper"
              >
                <span className="min-w-0">
                  <span className="block truncate">{item.name}</span>
                  {matched ? (
                    matched.toLowerCase() !== item.name.toLowerCase() && (
                      <span className="block truncate text-[12px] text-muted">&rarr; {matched}</span>
                    )
                  ) : (
                    <span className={`block truncate text-[12px] ${ERROR_TEXT}`}>{NO_MATCH_TEXT}</span>
                  )}
                </span>
                <StoreSelect
                  label={`Buy ${item.name} at`}
                  value={item.store}
                  stores={pinStoreOptions(h.stores)}
                  cheapestLabel="Cheapest"
                  onChange={(name) =>
                    update((prev) => ({
                      ...prev,
                      itemRules: prev.itemRules.map((r) => (r.id === item.id ? withPinnedStore(r, name) : r)),
                    }))
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => removeRule(item.id)}
                  className={removeIconBtn}
                >
                  &times;
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input
          className={fieldCls}
          placeholder={rule === 'always' ? 'Add an always-buy item' : 'Add a never-buy item'}
          aria-label={title}
          value={text}
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className={addBtn}>
          Add
        </button>
      </div>
    </div>
  );
}
