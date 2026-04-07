import { AiProviderCard } from '../components/settings/ai-provider-card';
import { IntelligenceSourcesCard } from '../components/settings/intelligence-sources-card';
import { IntelligenceScheduleCard } from '../components/settings/intelligence-schedule-card';
import { DataPrivacyCard } from '../components/settings/data-privacy-card';
import { CredentialVaultCard } from '../components/settings/credential-vault-card';
import { DangerZoneCard } from '../components/settings/danger-zone-card';

export default function Settings() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 max-w-4xl mx-auto w-full flex flex-col gap-6">
        <AiProviderCard />
        <IntelligenceSourcesCard />
        <IntelligenceScheduleCard />
        <DataPrivacyCard />
        <CredentialVaultCard />
        <DangerZoneCard />
      </div>
    </div>
  );
}
