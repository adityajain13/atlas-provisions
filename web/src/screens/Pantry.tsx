import { Header } from '../components/Header';
import { Page } from '../components/Page';

export default function Pantry() {
  return (
    <Page>
      <Header title="Pantry" />
      <p className="mt-4 text-[15px] text-muted">
        Coming soon: receipt scanning fills this automatically.
      </p>
    </Page>
  );
}
