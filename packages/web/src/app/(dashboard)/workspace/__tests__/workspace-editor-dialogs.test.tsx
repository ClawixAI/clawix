import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscardDialog, ConflictDialog } from '../workspace-dialogs';

describe('DiscardDialog', () => {
  it('shows filename in body', () => {
    render(
      <DiscardDialog
        filename="config.ts"
        open={true}
        onOpenChange={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText(/config\.ts/)).toBeInTheDocument();
  });

  it('calls onDiscard when Discard is clicked', async () => {
    const onDiscard = vi.fn();
    render(
      <DiscardDialog
        filename="config.ts"
        open={true}
        onOpenChange={vi.fn()}
        onDiscard={onDiscard}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalled();
  });
});

describe('ConflictDialog', () => {
  it('shows filename in body', () => {
    render(
      <ConflictDialog
        filename="config.ts"
        open={true}
        onOpenChange={vi.fn()}
        onOverwrite={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText(/config\.ts/)).toBeInTheDocument();
  });

  it('calls onOverwrite when Overwrite is clicked', async () => {
    const onOverwrite = vi.fn();
    render(
      <ConflictDialog
        filename="config.ts"
        open={true}
        onOpenChange={vi.fn()}
        onOverwrite={onOverwrite}
        onReload={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /overwrite/i }));
    expect(onOverwrite).toHaveBeenCalled();
  });

  it('calls onReload when Reload is clicked', async () => {
    const onReload = vi.fn();
    render(
      <ConflictDialog
        filename="config.ts"
        open={true}
        onOpenChange={vi.fn()}
        onOverwrite={vi.fn()}
        onReload={onReload}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalled();
  });
});
