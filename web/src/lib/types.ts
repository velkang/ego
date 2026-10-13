export type Event = {
  id: string;
  slug: string;
  title: string;
  venue: string;
  description: string;
  latitude: number;
  longitude: number;
  starts_at: number;
  ends_at: number;
  status: "draft" | "launching" | "active" | "paused" | "closed";
  budget: number;
  remaining?: number;
  min_amount?: number;
  max_amount?: number;
  distance?: number | null;
};
export type Spot = {
  id: string;
  event_id: string;
  title: string;
  latitude: number;
  longitude: number;
  radius: number;
  amount: number;
  capacity: number;
  remaining: number;
};
export type Claim = {
  id: string;
  eventId: string;
  spotId: string;
  amount: number;
  status: "reserved" | "submitted" | "confirmed" | "failed";
  transactionHash: string | null;
  error: string | null;
  createdAt: number;
};
export type Operation = {
  id: string;
  event_id: string;
  action: string;
  phase: string;
  status: string;
  error: string | null;
};
