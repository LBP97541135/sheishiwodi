import { useState } from 'react';

import {
  characterAssets,
  characterStateLabel,
  type CharacterKey,
  type CharacterState,
} from '../character-assets';

interface CharacterPortraitProps {
  characterKey: CharacterKey;
  label: string;
  state?: CharacterState;
}

export function CharacterPortrait({ characterKey, label, state = 'idle' }: CharacterPortraitProps) {
  const [failed, setFailed] = useState(false);
  const stateText = characterStateLabel[state];

  return (
    <div className="portrait" data-testid={`portrait-${characterKey}`} data-state={state}>
      {failed ? (
        <span className="portrait__fallback" aria-label={`${label} 占位头像`}>
          {label.slice(0, 1)}
        </span>
      ) : (
        <img
          src={characterAssets[characterKey][state]}
          alt={`${label} ${stateText}`}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
