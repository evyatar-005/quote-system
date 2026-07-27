import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown } from "lucide-react";

export default function CostSectionCard({ icon, image, title, description, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow duration-300">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-right"
      >
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {image ? (
                <img src={image} alt={title} className="w-16 h-16 rounded-xl object-cover shrink-0 border border-border" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  {icon}
                </div>
              )}
              <div>
                <CardTitle className="text-base font-semibold">{title}</CardTitle>
                {description && (
                  <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
                )}
              </div>
            </div>
            <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
          </div>
        </CardHeader>
      </button>
      {open && (
        <CardContent className="space-y-4">
          {children}
        </CardContent>
      )}
    </Card>
  );
}
