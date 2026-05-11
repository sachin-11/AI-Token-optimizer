import { Header } from "@/components/shared/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header title="Settings" description="Manage your account and preferences" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Profile</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium">sachin@moontechnolabs.com</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Role</span>
              <Badge variant="secondary">User</Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Plan</span>
              <Badge variant="outline">Free</Badge>
            </div>
          </CardContent>
        </Card>

        {/* API Key */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">API Key</CardTitle>
            <CardDescription>Use this key for programmatic access</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
              <code className="flex-1 truncate font-mono text-xs text-muted-foreground">
                apo_••••••••••••••••••••••••
              </code>
              <button className="text-xs text-primary hover:underline">Reveal</button>
              <button className="text-xs text-primary hover:underline">Rotate</button>
            </div>
          </CardContent>
        </Card>

        {/* Default model */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Default Model</CardTitle>
            <CardDescription>Used when no model is specified</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm">gpt-4o-mini</span>
              <Badge variant="success" className="text-xs">Active</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
