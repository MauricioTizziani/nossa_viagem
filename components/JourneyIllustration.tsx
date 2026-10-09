import { Heart, Plane } from 'lucide-react';

/** A quiet postcard motif shared by the collection and the itinerary. */
export default function JourneyIllustration() {
  return <div className="hero-art" aria-hidden="true">
    <svg className="art-route" viewBox="0 0 340 215" fill="none">
      <path d="M15 180C70 195 62 115 123 132S200 190 210 125 270 110 297 58" stroke="#7FBCC2" strokeWidth="2" strokeDasharray="5 8"/>
      <circle cx="16" cy="180" r="5" fill="#125E67" stroke="#7FBCC2" strokeWidth="2"/>
    </svg>
    <Plane className="art-plane" size={38} strokeWidth={1.3}/>
    <div className="postcard">
      <div className="postcard-picture">
        <svg viewBox="0 0 200 110" fill="none">
          <rect width="200" height="110" fill="#E0F0F1"/>
          <circle cx="150" cy="28" r="16" fill="#ECC5D1"/>
          <path d="M0 110L62 24 110 110Z" fill="#A2D7DB"/>
          <path d="M55 110L125 42 200 110Z" fill="#70B4B9"/>
          <path d="M53 37L62 24 75 43 65 39Z" fill="#FFFFFF"/>
          <path d="M0 89C46 74 73 107 126 90S184 85 200 82V110H0Z" fill="#C7E7E9"/>
          <path d="M70 110C86 94 89 101 104 92S124 85 122 76" stroke="#FFFFFF" strokeWidth="5"/>
        </svg>
        <div className="postcard-heart"><Heart size={16}/></div>
      </div>
      <p>O melhor destino<br/><em>é estar com você.</em></p>
    </div>
    <span className="art-caption">colecionando momentos</span>
  </div>;
}
