import React from 'react'
import { ConfigCenter } from '../../components/config/ConfigCenter'
import { SettingsGate } from '../../components/settings/SettingsGate'

export const SettingsTab: React.FC = () => {
  return (
    <SettingsGate>
      <ConfigCenter />
    </SettingsGate>
  )
}
