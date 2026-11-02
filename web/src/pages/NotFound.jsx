import { LuSearchX } from 'react-icons/lu';
import { Link } from '../router.jsx';
import { Empty } from '../ui.jsx';

export default function NotFound({ message }) {
  return (
    <main className="wrap">
      <div className="card"><Empty icon={LuSearchX} title="Not found">
        <p>{message || "This page doesn't exist, or you don't have access to it."}</p>
        <Link className="btn" to="/">Back to projects</Link>
      </Empty></div>
    </main>
  );
}
