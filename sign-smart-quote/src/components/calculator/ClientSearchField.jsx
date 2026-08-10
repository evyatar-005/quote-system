import { useEffect, useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList, CommandEmpty } from "@/components/ui/command";
import { searchMorningClients } from "@/api/morningClient";

// Plain-text client-name input that also searches Morning's existing clients
// (debounced) and offers them in a dropdown — including on focus with nothing
// typed yet, which browses the client list rather than requiring 2+ chars
// first. Picking one fills phone/address via onSelect. Creating a brand-new
// client is NOT offered from here — that used to duplicate the "שמור לקוח"
// button the calculator shows below this field once a typed name has no
// match, which confused agents with two different-looking ways to do the
// same thing. This field is search-only now; "שמור לקוח" is the one path.
export default function ClientSearchField({ value, onChange, onSelect, placeholder, className }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const items = await searchMorningClients(value);
        setResults(items);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className={className}
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        dir="rtl"
        className="p-0 w-[--radix-popover-trigger-width]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty className="py-3 text-sm text-muted-foreground text-center">אין תוצאות</CommandEmpty>
            <CommandGroup>
              {results.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onSelect(c);
                    setOpen(false);
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{c.name}</span>
                    {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
