import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 px-6">
      <div className="text-center">
        <div className="font-display text-6xl text-ink-900">404</div>
        <p className="mt-2 text-ink-500">This page can't be found.</p>
        <Link to="/" className="btn-outline mt-6">
          Back home
        </Link>
      </div>
    </div>
  );
}