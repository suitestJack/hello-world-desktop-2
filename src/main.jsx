import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <p className="eyebrow">AI Gang desktop template</p>
      <h1>Hello from Tauri</h1>
      <p>
        This React UI runs in the browser for fast iteration and inside the native
        shell for Windows, macOS, and Linux.
      </p>
      <div className="counter">
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          Click Me
        </button>
        <p className="count" aria-live="polite">
          Clicked {count} {count === 1 ? 'time' : 'times'}
        </p>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
