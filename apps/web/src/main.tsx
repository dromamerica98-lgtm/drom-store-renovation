import { render } from 'preact';

function App() {
  return (
    <main>
      <h1>Coach</h1>
      <p>Project scaffold. The Today screen arrives in Stage 5.</p>
    </main>
  );
}

render(<App />, document.getElementById('app')!);
