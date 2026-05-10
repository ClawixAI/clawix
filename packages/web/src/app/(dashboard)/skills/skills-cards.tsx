'use client';

import Link from 'next/link';
import { BookOpen, FolderOpen, Pencil, Trash } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface Skill {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'custom';
}

export function dirNameFromPath(skillPath: string): string {
  const parts = skillPath.split('/').filter(Boolean);
  if (parts.length < 2) {
    // Defensive: caller should never pass malformed paths, but a non-empty fallback
    // keeps the UI from emitting empty-string dirNames into URLs / API calls.
    return '';
  }
  return parts[parts.length - 2] ?? '';
}

export function BuiltinCard({ skill, onPreview }: { skill: Skill; onPreview?: () => void }) {
  return (
    <Card
      role={onPreview ? 'button' : undefined}
      tabIndex={onPreview ? 0 : undefined}
      onClick={onPreview}
      onKeyDown={(e) => {
        if (onPreview && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onPreview();
        }
      }}
      className="group cursor-pointer border-l-[3px] border-l-sky-500/50 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.01] hover:border-sky-500/40 hover:bg-sky-500/5 hover:shadow-[0_8px_24px_-8px_rgba(56,189,248,0.35)]"
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex size-10 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 transition-transform duration-200 group-hover:scale-110">
            <BookOpen className="size-5 text-sky-400" />
          </div>
          <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-400">
            builtin
          </Badge>
        </div>
        <CardTitle className="text-base">{skill.name}</CardTitle>
        <CardDescription className="line-clamp-3">{skill.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="truncate font-mono text-xs text-muted-foreground">{skill.path}</p>
      </CardContent>
    </Card>
  );
}

export function CustomCard({
  skill,
  dirName,
  onPreview,
  onEdit,
  onRename,
  onDelete,
}: {
  skill: Skill;
  dirName: string;
  onPreview?: () => void;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      role={onPreview ? 'button' : undefined}
      tabIndex={onPreview ? 0 : undefined}
      onClick={onPreview}
      onKeyDown={(e) => {
        if (onPreview && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onPreview();
        }
      }}
      className="group flex cursor-pointer flex-col border-l-[3px] border-l-primary/50 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.01] hover:border-primary/40 hover:bg-primary/10 hover:shadow-[0_8px_24px_-8px_rgba(217,119,6,0.4)]"
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex size-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 transition-transform duration-200 group-hover:scale-110">
            <BookOpen className="size-5 text-primary" />
          </div>
          <Badge variant="outline" className="border-primary/40 bg-primary/15 text-primary">
            custom
          </Badge>
        </div>
        <CardTitle className="text-base">{skill.name}</CardTitle>
        <CardDescription className="line-clamp-3">{skill.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="truncate font-mono text-xs text-muted-foreground">{skill.path}</p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="bg-foreground/10 hover:bg-foreground/20"
          onClick={(e) => {
            // Stop the click from bubbling to the parent Card and opening
            // the preview dialog.
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="mr-1 size-3" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="bg-foreground/10 hover:bg-foreground/20"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          Rename
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="bg-destructive/15 text-destructive hover:bg-destructive/25"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash className="mr-1 size-3" />
          Delete
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto bg-foreground/5 hover:bg-foreground/15"
          asChild
        >
          <Link href={`/workspace?path=/skills/${dirName}`} onClick={(e) => e.stopPropagation()}>
            <FolderOpen className="mr-1 size-3" />
            Manage files
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
