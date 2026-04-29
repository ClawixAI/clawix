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

export function BuiltinCard({ skill }: { skill: Skill }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex size-10 items-center justify-center rounded-lg border bg-muted">
            <BookOpen className="size-5 text-muted-foreground" />
          </div>
          <Badge variant="outline">builtin</Badge>
        </div>
        <CardTitle className="text-base">{skill.name}</CardTitle>
        <CardDescription className="line-clamp-3">{skill.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="truncate text-xs text-muted-foreground font-mono">{skill.path}</p>
      </CardContent>
    </Card>
  );
}

export function CustomCard({
  skill,
  dirName,
  onEdit,
  onRename,
  onDelete,
}: {
  skill: Skill;
  dirName: string;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex size-10 items-center justify-center rounded-lg border bg-muted">
            <BookOpen className="size-5 text-muted-foreground" />
          </div>
          <Badge variant="secondary">custom</Badge>
        </div>
        <CardTitle className="text-base">{skill.name}</CardTitle>
        <CardDescription className="line-clamp-3">{skill.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="truncate text-xs text-muted-foreground font-mono">{skill.path}</p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="mr-1 size-3" />
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={onRename}>
          Rename
        </Button>
        <Button size="sm" variant="outline" onClick={onDelete}>
          <Trash className="mr-1 size-3" />
          Delete
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/workspace?path=/skills/${dirName}`}>
            <FolderOpen className="mr-1 size-3" />
            Manage files
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
