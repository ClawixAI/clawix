'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, KeyRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authFetch } from '@/lib/auth';

interface Profile {
  id: string;
  email: string;
  name: string;
  role: string;
  policyId: string;
  isActive: boolean;
  telegramId: string | null;
  createdAt: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  // Profile form
  const [name, setName] = useState('');
  const [telegramId, setTelegramId] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [data, channels] = await Promise.all([
        authFetch<Profile>('/api/v1/me'),
        authFetch<{ data: { type: string; isActive: boolean }[] }>('/api/v1/channels').catch(
          () => ({ data: [] }),
        ),
      ]);
      setProfile(data);
      setName(data.name);
      setTelegramId(data.telegramId ?? '');
      setTelegramEnabled(
        Array.isArray(channels.data) &&
          channels.data.some((ch) => ch.type.toLowerCase() === 'telegram' && ch.isActive),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  async function handleSaveProfile(e: React.SyntheticEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const data = await authFetch<Profile>('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          telegramId: telegramId || null,
        }),
      });
      setProfile(data);
      setSuccess('Profile updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.SyntheticEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await authFetch('/api/v1/me/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account settings.</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:text-green-400">
          {success}
        </div>
      )}

      {/* Account info (read-only) */}
      <div className="rounded-lg border p-6">
        <h2 className="mb-4 text-lg font-semibold">Account</h2>
        <div className="grid gap-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{profile?.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Role</span>
            <Badge
              variant={
                profile?.role === 'admin'
                  ? 'default'
                  : profile?.role === 'developer'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {profile?.role}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge variant={profile?.isActive ? 'secondary' : 'outline'}>
              {profile?.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Member since</span>
            <span className="font-medium">
              {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Edit profile */}
      <form
        onSubmit={(e) => {
          void handleSaveProfile(e);
        }}
        className="rounded-lg border p-6"
      >
        <h2 className="mb-4 text-lg font-semibold">Edit Profile</h2>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-name">Display Name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              required
            />
          </div>
          {telegramEnabled && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-telegram">Telegram ID</Label>
              <Input
                id="profile-telegram"
                value={telegramId}
                onChange={(e) => {
                  setTelegramId(e.target.value);
                }}
                placeholder="Your numeric Telegram ID"
                pattern="\d*"
              />
              <p className="text-xs text-muted-foreground">
                Used to link your account with the Telegram bot. Message @userinfobot on Telegram to
                find your numeric ID.
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </form>

      {/* Change password */}
      <form
        onSubmit={(e) => {
          void handleChangePassword(e);
        }}
        className="rounded-lg border p-6"
      >
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-5" />
          Change Password
        </h2>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
              }}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
              }}
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
              }}
              minLength={8}
              required
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="outline" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Change Password
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
