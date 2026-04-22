import Link from 'next/link';
import { MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const tasks = [
  {
    id: '1',
    name: 'Daily Report Summary',
    agent: 'Report Generator',
    schedule: 'Every day at 09:00',
    lastRun: '2025-03-07 09:00',
    status: 'success' as const,
    nextRun: '2025-03-08 09:00',
    enabled: true,
  },
  {
    id: '2',
    name: 'Slack Channel Digest',
    agent: 'Support Bot',
    schedule: 'Every 2 hours',
    lastRun: '2025-03-07 16:00',
    status: 'success' as const,
    nextRun: '2025-03-07 18:00',
    enabled: true,
  },
  {
    id: '3',
    name: 'Code Quality Scan',
    agent: 'Code Reviewer',
    schedule: '0 2 * * MON',
    lastRun: '2025-03-03 02:00',
    status: 'failed' as const,
    nextRun: '2025-03-10 02:00',
    enabled: true,
  },
  {
    id: '4',
    name: 'Data Pipeline Check',
    agent: 'Data Analyst',
    schedule: 'Every 30 minutes',
    lastRun: '2025-03-07 16:30',
    status: 'success' as const,
    nextRun: '2025-03-07 17:00',
    enabled: false,
  },
  {
    id: '5',
    name: 'Weekly Competitor Research',
    agent: 'Research Assistant',
    schedule: '0 8 * * FRI',
    lastRun: '2025-03-07 08:00',
    status: 'success' as const,
    nextRun: '2025-03-14 08:00',
    enabled: true,
  },
];

export default function TasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scheduled Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Manage recurring and one-time scheduled agent tasks.
          </p>
        </div>
        <Button>
          <Plus className="mr-2 size-4" />
          New Task
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Next Run</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id} className={!task.enabled ? 'opacity-50' : undefined}>
                <TableCell className="font-medium">
                  <Link href={`/tasks/${task.id}`} className="hover:underline">
                    {task.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{task.agent}</TableCell>
                <TableCell>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{task.schedule}</code>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{task.lastRun}</TableCell>
                <TableCell>
                  <Badge variant={task.status === 'success' ? 'secondary' : 'destructive'}>
                    {task.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {task.enabled ? task.nextRun : '--'}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem>Run Now</DropdownMenuItem>
                      <DropdownMenuItem>{task.enabled ? 'Disable' : 'Enable'}</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
