import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

// Renders a Date as "YYYY-MM-DD HH:MM:SS UTC" so the value is stable across
// machine timezones (browser and native shell alike).
function formatUtc(date) {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

// Baked in at build time so the running page can be traced back to the CI build
// that produced it. Unset for local `npm run dev` / `npm run build`, which is
// not a numbered build -- say so rather than showing a misleading number.
const BUILD_NUMBER = import.meta.env.VITE_BUILD_NUMBER || 'local';

function App() {
  const [count, setCount] = useState(0);
  const [lastIncremented, setLastIncremented] = useState(null);

  // Nothing has been counted yet, so Reset has no work to do.
  const isPristine = count === 0 && lastIncremented === null;

  function increment() {
    setCount((value) => value + 1);
    setLastIncremented(new Date());
  }

  // Puts the counter back to the state it renders in on a fresh load: both the
  // count and the timestamp are cleared together so they never disagree.
  function reset() {
    setCount(0);
    setLastIncremented(null);
  }

  return (
    <main>
      <p className="eyebrow">AI Gang desktop template</p>
      <div className="counter">
        <div className="actions">
          <button type="button" onClick={increment}>
            Click Me
          </button>
          <button
            type="button"
            className="reset"
            onClick={reset}
            disabled={isPristine}
          >
            Reset
          </button>
        </div>
        <p className="count" aria-live="polite">
          Clicked {count} {count === 1 ? 'time' : 'times'}
        </p>
        <p className="last-incremented" aria-live="polite">
          Last Incremented:{' '}
          {lastIncremented ? (
            <time dateTime={lastIncremented.toISOString()}>
              {formatUtc(lastIncremented)}
            </time>
          ) : (
            <span className="never">never</span>
          )}
        </p>
        <p className="build-number">Build: {BUILD_NUMBER}</p>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
