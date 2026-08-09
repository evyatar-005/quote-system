import { useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList, CommandEmpty } from "@/components/ui/command";
import { searchMorningClients } from "@/api/morningClient";
import NewClientModal from "./NewClientModal";

// Plain-text client-name input that also searches Morning's existing clients
// (debounced) and offers them in a dropdown — including on focus with nothing
// typed yet, which browses the client list rather than requiring 2+ chars
// first. Picking one fills phone/address via onSelect. If a typed name has no
// match, "לקוח חדש" opens NewClientModal to create one on the spot (with
// payment terms) instead of just continuing as an unregistered name.
export default function ClientSearchField({ value, onChange, onSelect, placeholder, className }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [showNewClient, setShowNewClient] = useState(false);
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
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className={className}
            autoComplete="off"
          />
        </PopoverAnchor>
        <PopoverContent
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
              <div className="border-t p-1">
                <CommandItem
                  value="__new_client__"
                  onSelect={() => {
                    setOpen(false);
                    setShowNewClient(true);
                  }}
                  className="text-amber-600 font-medium"
                >
                  <UserPlus className="w-4 h-4 ml-2" />
                  לקוח חדש{value?.trim() ? ` — "${value.trim()}"` : ""}
                </CommandItem>
              </div>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showNewClient && (
        <NewClientModal
          initialName={value}
          onClose={() => setShowNewClient(false)}
          onCreated={(client) => {
            setShowNewClient(false);
            onSelect(client);
          }}
        />
      )}
    </>
  );
}
