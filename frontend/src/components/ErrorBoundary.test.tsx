import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): never {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  it('shows a way to recover instead of a blank page when rendering throws', () => {
    // React logs the caught error; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
      expect(screen.getByText('render failed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });
});
