'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Package, Plus, User, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authFetch } from '@/lib/auth';
import type { SkillReadResult } from '@clawix/shared';
import { BuiltinCard, CustomCard, type Skill, dirNameFromPath } from './skills-cards';
import {
  CreateDialog,
  DeleteDialog,
  EditDialog,
  PreviewDialog,
  RenameDialog,
} from './skills-dialogs';

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ dirName: string; content: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ dirName: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ dirName: string; name: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{
    dirName: string;
    name: string;
    source: 'builtin' | 'custom';
    content: string;
  } | null>(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch<{ success: boolean; data: Skill[] }>('/api/v1/skills');
      setSkills(Array.isArray(res.data) ? res.data : []);
      setError('');
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

  const handleEditClick = async (skill: Skill) => {
    const dirName = dirNameFromPath(skill.path);
    try {
      const res = await authFetch<{ success: boolean; data: SkillReadResult }>(
        `/api/v1/skills/${dirName}`,
      );
      setEditTarget({ dirName, content: res.data.content });
    } catch {
      setError('Failed to load skill content');
    }
  };

  const handlePreviewClick = async (skill: Skill) => {
    const dirName = dirNameFromPath(skill.path);
    try {
      const res = await authFetch<{ success: boolean; data: SkillReadResult }>(
        `/api/v1/skills/${dirName}`,
      );
      setPreviewTarget({
        dirName,
        name: skill.name,
        source: skill.source,
        content: res.data.content,
      });
    } catch {
      setError('Failed to load skill content');
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
            agent toolkit
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Skills extend your agent&apos;s capabilities with specialized knowledge and workflows.
          Custom skills live inside your workspace under{' '}
          <code className="rounded bg-foreground/5 px-1 font-mono text-xs">
            /skills/&lt;name&gt;
          </code>
          .
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Built-in */}
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
              <BuiltinCard
                key={skill.path}
                skill={skill}
                onPreview={() => void handlePreviewClick(skill)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Custom */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Your Skills</h2>
            <Badge variant="secondary" className="text-xs">
              {customSkills.length}
            </Badge>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            Create skill
          </Button>
        </div>

        {customSkills.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <Wrench className="mb-2 size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No custom skills yet. Click &quot;Create skill&quot; to add one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {customSkills.map((skill) => {
              const dirName = dirNameFromPath(skill.path);
              return (
                <CustomCard
                  key={skill.path}
                  skill={skill}
                  dirName={dirName}
                  onPreview={() => void handlePreviewClick(skill)}
                  onEdit={() => handleEditClick(skill)}
                  onRename={() => setRenameTarget({ dirName })}
                  onDelete={() => setDeleteTarget({ dirName, name: skill.name })}
                />
              );
            })}
          </div>
        )}
      </section>

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void fetchSkills();
        }}
      />
      <EditDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          void fetchSkills();
        }}
      />
      <RenameDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={() => {
          setRenameTarget(null);
          void fetchSkills();
        }}
      />
      <DeleteDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          void fetchSkills();
        }}
      />
      <PreviewDialog
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
        onEdit={
          previewTarget?.source === 'custom'
            ? () => {
                setEditTarget({
                  dirName: previewTarget.dirName,
                  content: previewTarget.content,
                });
                setPreviewTarget(null);
              }
            : undefined
        }
      />
    </div>
  );
}
