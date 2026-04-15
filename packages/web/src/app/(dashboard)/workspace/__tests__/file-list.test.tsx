import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileList } from '../file-list';
import type { FileEntry } from '@clawix/shared';

const mockEntries: FileEntry[] = [
  { name: 'src', path: '/src', size: 0, modifiedAt: '2026-04-10T00:00:00Z', isDirectory: true, type: 'directory' },
  { name: 'README.md', path: '/README.md', size: 1024, modifiedAt: '2026-04-10T01:00:00Z', isDirectory: false, type: 'markdown' },
];

describe('FileList', () => {
  it('renders file entries', () => {
    render(
      <FileList entries={mockEntries} selectedPath={null} onNavigate={vi.fn()} onSelectFile={vi.fn()} />,
    );
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('shows empty state when no entries', () => {
    render(
      <FileList entries={[]} selectedPath={null} onNavigate={vi.fn()} onSelectFile={vi.fn()} />,
    );
    expect(screen.getByText('This workspace is empty')).toBeInTheDocument();
  });

  it('calls onNavigate when directory is clicked', async () => {
    const onNavigate = vi.fn();
    render(
      <FileList entries={mockEntries} selectedPath={null} onNavigate={onNavigate} onSelectFile={vi.fn()} />,
    );
    await userEvent.click(screen.getByText('src'));
    expect(onNavigate).toHaveBeenCalledWith('/src');
  });

  it('calls onSelectFile when file is clicked', async () => {
    const onSelectFile = vi.fn();
    render(
      <FileList entries={mockEntries} selectedPath={null} onNavigate={vi.fn()} onSelectFile={onSelectFile} />,
    );
    await userEvent.click(screen.getByText('README.md'));
    expect(onSelectFile).toHaveBeenCalledWith(mockEntries[1]);
  });
});
