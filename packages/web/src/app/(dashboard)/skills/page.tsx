'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Loader2, Package, User, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { authFetch } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Skill {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'custom';
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSkills = useCallback(async () => {
    try {
      const res = await authFetch<{ success: boolean; data: Skill[] }>(
        '/api/v1/skills',
      );
      setSkills(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  const builtinSkills = skills.filter((s) => s.source === 'builtin');
  const customSkills = skills.filter((s) => s.source === 'custom');

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
        <p className="text-sm text-muted-foreground">
          Skills extend your agent&apos;s capabilities with specialized knowledge and workflows.
          Use <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/create-skill</code> in a conversation to create new ones.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Builtin Skills */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Built-in Skills</h2>
          <Badge variant="secondary" className="text-xs">
            {builtinSkills.length}
          </Badge>
        </div>

        {builtinSkills.length === 0 ? (
          <p className="text-sm text-muted-foreground">No built-in skills found.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {builtinSkills.map((skill) => (
              <SkillCard key={skill.path} skill={skill} />
            ))}
          </div>
        )}
      </section>

      {/* Custom Skills */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <User className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Your Skills</h2>
          <Badge variant="secondary" className="text-xs">
            {customSkills.length}
          </Badge>
        </div>

        {customSkills.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <Wrench className="mb-2 size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No custom skills yet. Type{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/skill-creator</code>{' '}
                in a conversation to create one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {customSkills.map((skill) => (
              <SkillCard key={skill.path} skill={skill} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SkillCard                                                          */
/* ------------------------------------------------------------------ */

function SkillCard({ skill }: { skill: Skill }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex size-10 items-center justify-center rounded-lg border bg-muted">
            <BookOpen className="size-5 text-muted-foreground" />
          </div>
          <Badge variant={skill.source === 'builtin' ? 'outline' : 'secondary'}>
            {skill.source}
          </Badge>
        </div>
        <CardTitle className="text-base">{skill.name}</CardTitle>
        <CardDescription className="line-clamp-3">{skill.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="truncate text-xs text-muted-foreground font-mono">{skill.path}</p>
      </CardContent>
    </Card>
  );
}
