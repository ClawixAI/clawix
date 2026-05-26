import { permanentRedirect } from 'next/navigation';

export default function SchemaRedirect() {
  permanentRedirect('/wiki?view=schema');
}
