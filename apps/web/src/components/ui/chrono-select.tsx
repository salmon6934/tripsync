'use client';

import * as React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from '@/components/ui/select';

interface ChronoSelectProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  /** Inclusive [start, end] years offered in the year dropdown. */
  yearRange?: [number, number];
  /** Constrain selectable days (forwarded to the calendar). */
  disabled?: React.ComponentProps<typeof Calendar>['disabled'];
  id?: string;
}

export function ChronoSelect({
  value,
  onChange,
  placeholder = 'Pick a date',
  className,
  yearRange = [1970, 2050],
  disabled,
  id,
}: ChronoSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState<Date>(value ?? new Date());

  // Keep the visible month in sync when the controlled value changes from
  // outside (e.g. a form reset or a linked start/end pair).
  React.useEffect(() => {
    if (value) setMonth(value);
  }, [value]);

  const years = React.useMemo(() => {
    const [start, end] = yearRange;
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [yearRange]);

  const handleSelect = (date: Date | undefined) => {
    setOpen(false);
    onChange?.(date);
  };

  const handleYearChange = (year: string) => {
    const newDate = new Date(month);
    newDate.setFullYear(parseInt(year, 10));
    setMonth(newDate);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn(
            'w-[280px] justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, 'PPP') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto space-y-2 p-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-medium">{format(month, 'MMMM')}</span>
          <Select value={String(month.getFullYear())} onValueChange={handleYearChange}>
            <SelectTrigger className="h-7 w-[90px] text-xs">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Calendar
          mode="single"
          selected={value}
          onSelect={handleSelect}
          month={month}
          onMonthChange={setMonth}
          disabled={disabled}
          className="rounded-md border border-border"
        />
      </PopoverContent>
    </Popover>
  );
}
