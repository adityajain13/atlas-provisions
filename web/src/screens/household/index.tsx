import { useNavigate } from 'react-router-dom';
import { AppearanceControl } from '../../components/Appearance';
import { SaveStatus } from '../../components/SaveStatus';
import { Header } from '../../components/Header';
import { Page } from '../../components/Page';
import { useSession } from '../../session';
import { useHouseholdDoc } from '../../lib/useHouseholdDoc';

import { AccessSection } from './AccessSection';
import { BudgetSection } from './BudgetSection';
import { CuisinesSection } from './CuisinesSection';
import { DishesSection } from './DishesSection';
import { AllergiesSection, EquipmentSection } from './EquipmentSection';
import { FixedMealsSection } from './FixedMealsSection';
import { StorageSection, FormsSection } from './FormsSection';
import { ItemRulesSection } from './ItemRulesSection';
import { LearnedSection } from './LearnedSection';
import { MembersSection } from './MembersSection';
import { PeopleSection } from './PeopleSection';
import { ScheduleSection, PrepSection } from './ScheduleSection';
import { SpiceRackSection } from './SpiceRackSection';
import { StoresSection } from './StoresSection';
import { VarietySection } from './VarietySection';
import { ERROR_TEXT } from './ui';

// ---------- screen: loads, holds state, autosaves ----------

export default function HouseholdScreen() {
  const { h, update, loadError } = useHouseholdDoc();
  const navigate = useNavigate();

  return (
    <Page>
      <Header title="Household" status={<SaveStatus />} />

      <button
        type="button"
        onClick={() => navigate('/setup')}
        className="mt-6 flex min-h-11 w-full items-center justify-between gap-4 rounded-lg border border-line2 px-4 text-left text-[14px] text-paper hover:border-herb"
      >
        <span>Setup guide &mdash; walk through everything again</span>
        <span aria-hidden="true" className="text-herb">
          &rarr;
        </span>
      </button>

      {loadError && <p className={`mt-6 text-[14px] ${ERROR_TEXT}`}>Could not load: {loadError}</p>}
      {!h && !loadError && <p className="mt-10 text-[14px] text-muted">Loading&hellip;</p>}

      {h && (
        <div className="lg:mt-10 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-12">
          <div className="lg:flex lg:flex-col lg:gap-12">
            <MembersSection />
            <AccessSection />
            <PeopleSection h={h} update={update} />
            <ScheduleSection h={h} update={update} />
            <PrepSection h={h} update={update} />
            <StorageSection h={h} update={update} />
            <FixedMealsSection h={h} update={update} />
            <ItemRulesSection h={h} update={update} />
            <DishesSection h={h} update={update} />
            <CuisinesSection h={h} update={update} />
            <LearnedSection />
          </div>
          <div className="lg:flex lg:flex-col lg:gap-12">
            <AllergiesSection h={h} />
            <EquipmentSection h={h} update={update} />
            <FormsSection h={h} update={update} />
            <SpiceRackSection h={h} update={update} />
            <VarietySection h={h} update={update} />
            <BudgetSection h={h} update={update} />
            <StoresSection h={h} update={update} />
          </div>
        </div>
      )}

      <div className="mt-10 border-t border-line pt-4 lg:hidden">
        <AppearanceControl />
      </div>

      <SessionRow />
    </Page>
  );
}

/** Who is signed in on this device, with sign out. */
function SessionRow() {
  const { state, signOut } = useSession();
  if (state.status !== 'in') return null;
  return (
    <p className="mt-10 border-t border-line pt-4 text-[13px] text-muted lg:hidden">
      Signed in as {state.email} ·{' '}
      <button type="button" onClick={() => void signOut()} className="text-herb">
        Sign out
      </button>
    </p>
  );
}
