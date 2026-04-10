'use client';

import { Fragment } from 'react';
import { Home } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

interface WorkspaceBreadcrumbsProps {
  readonly currentPath: string;
  readonly onNavigate: (path: string) => void;
}

function buildSegments(currentPath: string): readonly { name: string; path: string }[] {
  if (currentPath === '/') return [];
  const parts = currentPath.split('/').filter(Boolean);
  return parts.map((part, i) => ({
    name: part,
    path: '/' + parts.slice(0, i + 1).join('/'),
  }));
}

export function WorkspaceBreadcrumbs({ currentPath, onNavigate }: WorkspaceBreadcrumbsProps) {
  const segments = buildSegments(currentPath);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {segments.length === 0 ? (
            <BreadcrumbPage className="flex items-center gap-1.5">
              <Home className="size-3.5" />
              Workspace
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              className="flex cursor-pointer items-center gap-1.5"
              onClick={() => onNavigate('/')}
            >
              <Home className="size-3.5" />
              Workspace
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {segments.map((segment, i) => {
          const isLast = i === segments.length - 1;
          return (
            <Fragment key={segment.path}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{segment.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="cursor-pointer"
                    onClick={() => onNavigate(segment.path)}
                  >
                    {segment.name}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
