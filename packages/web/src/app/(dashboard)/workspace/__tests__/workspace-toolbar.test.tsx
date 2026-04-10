import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceToolbar } from '../workspace-toolbar';

describe('WorkspaceToolbar', () => {
  it('renders all action buttons', () => {
    render(
      <WorkspaceToolbar entryCount={5} onNewFile={vi.fn()} onNewFolder={vi.fn()} onUpload={vi.fn()} />,
    );
    expect(screen.getByText('New File')).toBeInTheDocument();
    expect(screen.getByText('New Folder')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

  it('displays item count', () => {
    render(
      <WorkspaceToolbar entryCount={3} onNewFile={vi.fn()} onNewFolder={vi.fn()} onUpload={vi.fn()} />,
    );
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('displays singular item for count of 1', () => {
    render(
      <WorkspaceToolbar entryCount={1} onNewFile={vi.fn()} onNewFolder={vi.fn()} onUpload={vi.fn()} />,
    );
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('calls onNewFile when button is clicked', async () => {
    const onNewFile = vi.fn();
    render(
      <WorkspaceToolbar entryCount={0} onNewFile={onNewFile} onNewFolder={vi.fn()} onUpload={vi.fn()} />,
    );
    await userEvent.click(screen.getByText('New File'));
    expect(onNewFile).toHaveBeenCalledOnce();
  });

  it('calls onNewFolder when button is clicked', async () => {
    const onNewFolder = vi.fn();
    render(
      <WorkspaceToolbar entryCount={0} onNewFile={vi.fn()} onNewFolder={onNewFolder} onUpload={vi.fn()} />,
    );
    await userEvent.click(screen.getByText('New Folder'));
    expect(onNewFolder).toHaveBeenCalledOnce();
  });

  it('calls onUpload when button is clicked', async () => {
    const onUpload = vi.fn();
    render(
      <WorkspaceToolbar entryCount={0} onNewFile={vi.fn()} onNewFolder={vi.fn()} onUpload={onUpload} />,
    );
    await userEvent.click(screen.getByText('Upload'));
    expect(onUpload).toHaveBeenCalledOnce();
  });
});
