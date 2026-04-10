'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import {
  BookOpen,
  Bot,
  ChevronRight,
  ChevronsUpDown,
  Coins,
  CreditCard,
  FolderOpen,
  GalleryVerticalEnd,
  LogOut,
  MessageSquare,
  Moon,
  Radio,
  ScrollText,
  Settings2,
  Sun,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import anime from 'animejs';
import { EASING } from '@/lib/anime';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const platformItems = [
  {
    title: 'Conversations',
    icon: MessageSquare,
    href: '/conversations',
  },
  {
    title: 'Skills',
    icon: Wrench,
    href: '/skills',
  },
  {
    title: 'Workspace',
    icon: FolderOpen,
    href: '/workspace',
  },
];

const governanceItems = [
  { title: 'Dashboard', href: '/dashboard', icon: BookOpen },
  { title: 'Token Usage', href: '/governance/tokens', icon: Coins },
  { title: 'Audit Logs', href: '/governance/audit', icon: ScrollText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const animateSubItems = useCallback((container: HTMLElement) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = container.querySelectorAll('[data-sidebar="menu-sub-item"]');
    items.forEach((el) => {
      (el as HTMLElement).style.opacity = '0';
      (el as HTMLElement).style.transform = 'translateY(8px)';
    });
    anime({
      targets: items,
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 300,
      delay: anime.stagger(50),
      easing: EASING,
    });
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="group-data-[collapsible=icon]:hidden">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Clawix</span>
                  <span className="truncate text-xs">Enterprise AI Platform</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {platformItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            <Collapsible
              defaultOpen={pathname.startsWith('/agents')}
              className="group/collapsible-agents"
              onOpenChange={(open) => {
                if (open) {
                  requestAnimationFrame(() => {
                    const el = document.querySelector('.group\\/collapsible-agents [data-sidebar="menu-sub"]');
                    if (el) animateSubItems(el as HTMLElement);
                  });
                }
              }}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton isActive={pathname.startsWith('/agents')} tooltip="Agents">
                    <Bot />
                    <span>Agents</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible-agents:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {[
                      { title: 'Definitions', href: '/agents/definitions', icon: Bot },
                      { title: 'User Agents', href: '/agents/user-agents', icon: Users },
                    ].map((item) => (
                      <SidebarMenuSubItem key={item.title}>
                        <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Governance</SidebarGroupLabel>
          <SidebarMenu>
            {governanceItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            <Collapsible
              defaultOpen={pathname.startsWith('/settings')}
              className="group/collapsible"
              onOpenChange={(open) => {
                if (open) {
                  requestAnimationFrame(() => {
                    const el = document.querySelector('.group\\/collapsible [data-sidebar="menu-sub"]');
                    if (el) animateSubItems(el as HTMLElement);
                  });
                }
              }}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton isActive={pathname.startsWith('/settings')} tooltip="Settings">
                    <Settings2 />
                    <span>Settings</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {[
                      { title: 'Users', href: '/settings/users', icon: Users },
                      { title: 'Plans', href: '/settings/plans', icon: CreditCard },
                      { title: 'Channels', href: '/settings/channels', icon: Radio },
                      { title: 'Providers', href: '/settings/providers', icon: Bot },
                    ].map((item) => (
                      <SidebarMenuSubItem key={item.title}>
                        <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              tooltip={isDark ? 'Light mode' : 'Dark mode'}
              onClick={() => { setTheme(isDark ? 'light' : 'dark'); }}
            >
              <Sun className="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
              <span>{mounted ? (isDark ? 'Light mode' : 'Dark mode') : 'Toggle theme'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">
                      {(user?.email[0] ?? 'U').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {user?.email.split('@')[0] ?? 'User'}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user?.email ?? 'user@example.com'}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-[--radix-dropdown-menu-trigger-width]"
              >
                <DropdownMenuItem onSelect={() => { router.push('/profile'); }}>
                  <User className="mr-2 size-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    void logout().then(() => {
                      router.push('/login');
                    });
                  }}
                >
                  <LogOut className="mr-2 size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
