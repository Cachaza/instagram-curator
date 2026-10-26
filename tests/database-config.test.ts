import {expect,test} from "bun:test";
import {databaseConfig} from "../src/lib/database-config";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

test("URL parameters cannot disable or replace explicitly verified TLS",() => {
  const directory=mkdtempSync(join(tmpdir(),"curator-ca-"));
  const ca=join(directory,"ca.pem");writeFileSync(ca,"synthetic certificate configuration fixture");
  try {
    for(const mode of ["disable","verify-full"]) expect(() => databaseConfig({DATABASE_URL:`postgresql://example.invalid/curator?sslmode=${mode}`,CURATOR_DATABASE_CA_FILE:ca})).toThrow("Remove SSL parameters");
    expect(() => databaseConfig({DATABASE_URL:"postgresql://example.invalid/curator?options=ignored"})).toThrow("Remove options");
    expect(databaseConfig({DATABASE_URL:"postgresql://example.invalid/curator",CURATOR_DATABASE_CA_FILE:ca}).ssl).toEqual({ca:"synthetic certificate configuration fixture",rejectUnauthorized:true});
  } finally {rmSync(directory,{recursive:true,force:true});}
});
