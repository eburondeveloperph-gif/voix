/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import './PopUp.css';

interface PopUpProps {
  onClose: () => void;
}

const PopUp: React.FC<PopUpProps> = ({ onClose }) => {
  return (
    <div className="popup-overlay">
      <div className="popup-content">
        <h2>Welcome to Beatrice Playground</h2>
        <p>Your live workspace for native audio, realtime transcripts, and tool-driven voice sessions.</p>
        <p>To get started:</p>
        <ol>
          <li><span className="icon material-symbols-outlined">play_circle</span>Press play to start a live Beatrice session.</li>
          <li><span className="icon material-symbols-outlined">mic</span>Use the microphone control to mute or resume capture.</li>
          <li><span className="icon material-symbols-outlined">tune</span>Open Voice Hub to switch persona, prompts, and services.</li>
        </ol>
        <button onClick={onClose}>Enter Playground</button>
      </div>
    </div>
  );
};

export default PopUp;
