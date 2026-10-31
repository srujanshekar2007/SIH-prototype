import logo from '../assets/synapse-logo.png';

export default function BrandLogo() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <img className="brand-logo-image" src={logo} alt="" />
    </div>
  );
}
