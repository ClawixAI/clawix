'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff, GalleryVerticalEnd, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/auth-provider';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      const redirect = searchParams.get('redirect');
      // Prevent open redirect — only allow relative paths
      const target = redirect?.startsWith('/') ? redirect : '/conversations';
      router.push(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full">
      {/* Left panel */}
      <div className="flex flex-1 flex-col gap-4 p-10">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GalleryVerticalEnd className="size-4" />
          </div>
          <span className="text-sm font-medium">Clawix</span>
        </div>

        {/* Login form */}
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-[320px] flex-col gap-7">
            {/* Header */}
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-2xl font-bold tracking-tight">Login to Clawix</h1>
              <p className="text-sm text-muted-foreground">
                Enter your email below to login to your account
              </p>
            </div>

            {/* Form */}
            <form
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
              className="flex flex-col gap-7"
            >
              <div className="flex flex-col gap-6">
                {/* Email field */}
                <div className="flex flex-col gap-3">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                    }}
                    required
                    disabled={isLoading}
                  />
                </div>

                {/* Password field */}
                <div className="flex flex-col gap-3">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                      }}
                      required
                      disabled={isLoading}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setShowPassword(!showPassword);
                      }}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
                Login
              </Button>
            </form>

          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="relative hidden flex-1 bg-neutral-100 lg:block">
        <Image
          src="/images/login-bg.png"
          alt=""
          fill
          sizes="50vw"
          className="object-cover opacity-50"
          priority
        />
      </div>
    </div>
  );
}
