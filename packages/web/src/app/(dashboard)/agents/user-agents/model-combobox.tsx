'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ModelComboboxProps {
  id: string;
  name: string;
  models: readonly string[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}

/**
 * Editable combobox for picking a model. The user can type any string (custom
 * provider models aren't enumerable) and we surface known options as a styled
 * popover that matches the rest of the dark UI — replacing the browser-native
 * <datalist> popup, which renders white and ignores the design system.
 */
export function ModelCombobox({
  id,
  name,
  models,
  defaultValue,
  placeholder,
  required,
}: ModelComboboxProps) {
  const [value, setValue] = useState(defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(defaultValue ?? '');
  }, [defaultValue]);

  const filtered = value.trim()
    ? models.filter((m) => m.toLowerCase().includes(value.trim().toLowerCase()))
    : models;

  return (
    <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            ref={inputRef}
            id={id}
            name={name}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            required={required}
            autoComplete="off"
            className="pr-9"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.preventDefault();
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-0 flex items-center pr-2 text-muted-foreground hover:text-foreground"
            aria-label="Toggle suggestions"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.map((m) => (
            <li key={m}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // Use mousedown so the input keeps focus through the click —
                  // an onClick fires after blur, which would close the popover
                  // before the value commits.
                  e.preventDefault();
                  setValue(m);
                  setOpen(false);
                  inputRef.current?.focus();
                }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                  value === m && 'bg-accent/50',
                )}
              >
                <span className="truncate">{m}</span>
                {value === m ? <Check className="size-4 shrink-0" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
