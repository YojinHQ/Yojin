import { DailyInsightsCard } from '../components/profile/daily-insights-card';
import { DeliveryChannelsCard } from '../components/profile/delivery-channels-card';
import { NotificationRoutingCard } from '../components/profile/notification-routing-card';

export default function Profile() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 max-w-4xl mx-auto w-full flex flex-col gap-6">
        <DailyInsightsCard />
        <DeliveryChannelsCard />
        <NotificationRoutingCard />
      </div>
    </div>
  );
}
