import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateDialog, DeleteDialog } from '../workspace-dialogs';

describe('CreateDialog', () => {
  it('renders with file title', () => {
    render(<CreateDialog type="file" open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('Create New File')).toBeInTheDocument();
  });

  it('renders with folder title', () => {
    render(<CreateDialog type="directory" open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('Create New Folder')).toBeInTheDocument();
  });

  it('disables Create button when name is empty', () => {
    render(<CreateDialog type="file" open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('Create')).toBeDisabled();
  });

  it('shows validation error for name with slashes', async () => {
    render(<CreateDialog type="file" open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    const input = screen.getByPlaceholderText('e.g. index.ts');
    await userEvent.type(input, 'a/b.txt');
    expect(screen.getByText('Name cannot contain slashes')).toBeInTheDocument();
  });

  it('calls onConfirm with name when Create is clicked', async () => {
    const onConfirm = vi.fn();
    render(<CreateDialog type="file" open={true} onOpenChange={vi.fn()} onConfirm={onConfirm} />);
    const input = screen.getByPlaceholderText('e.g. index.ts');
    await userEvent.type(input, 'test.ts');
    await userEvent.click(screen.getByText('Create'));
    expect(onConfirm).toHaveBeenCalledWith('test.ts');
  });
});

describe('DeleteDialog', () => {
  it('shows file name in title', () => {
    render(
      <DeleteDialog name="readme.md" isDirectory={false} open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(/readme\.md/)).toBeInTheDocument();
  });

  it('shows child count for directories', () => {
    render(
      <DeleteDialog name="src" isDirectory={true} childCount={12} open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(/12 items/)).toBeInTheDocument();
  });

  it('shows generic message when childCount is undefined', () => {
    render(
      <DeleteDialog name="src" isDirectory={true} open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(/all its contents/)).toBeInTheDocument();
  });

  it('calls onConfirm when Delete is clicked', async () => {
    const onConfirm = vi.fn();
    render(
      <DeleteDialog name="file.txt" isDirectory={false} open={true} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );
    await userEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
