import { v5 as uuidv5, NIL as NIL_UUID } from 'uuid'

export function toUUID(id: string, namespace: string = NIL_UUID): string {
  return uuidv5(id, namespace)
}
