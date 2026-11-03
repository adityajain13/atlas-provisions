import { Navigate, Route, Routes } from 'react-router-dom';
import TabBar from './components/TabBar';
import Week from './screens/Week';
import List from './screens/List';
import Plan from './screens/Plan';
import HouseholdScreen from './screens/Household';
import Pantry from './screens/Pantry';

export default function App() {
  return (
    <div className="min-h-screen bg-ink font-sans text-paper">
      <Routes>
        <Route path="/" element={<Week />} />
        <Route path="/list" element={<List />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/household" element={<HouseholdScreen />} />
        <Route path="/pantry" element={<Pantry />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar />
    </div>
  );
}
