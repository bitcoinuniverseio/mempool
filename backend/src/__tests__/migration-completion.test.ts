import {isolatedBackend,defaultMock,quietLogger} from '../../test-support/isolated-backend-helper';
describe('ordered migration completion',()=>{
  function setup(initial: number,fail=false){
    let version=initial;let key='height';const markers: number[]=[];const statements: string[]=[];
    const db:any={query:async(query: any)=>{
      const sql=typeof query==='string'?query:query.sql;statements.push(sql);
      if(sql.includes('SELECT VERSION'))return [[{version:'8.4'}]];
      if(sql.includes('COUNT(*) FROM information_schema.tables'))return [[{'COUNT(*)':1}]];
      if(sql.includes('SELECT number FROM state'))return [[{number:version}]];
      if(sql.includes('SELECT INDEX_NAME'))return [[{INDEX_NAME:'PRIMARY',COLUMN_NAME:key,SEQ_IN_INDEX:1},{INDEX_NAME:'height',COLUMN_NAME:'height',SEQ_IN_INDEX:1}]];
      if(sql.startsWith('ALTER TABLE blocks') && sql.includes('ADD PRIMARY KEY')){if(fail)throw Error('injected key DDL failure');key='hash';}
      const match=sql.match(/UPDATE state SET number = (\d+) WHERE name = 'schema_version'/);if(match){version=+match[1];markers.push(version);}
      return [[],[]];
    },$transaction:async(fn:any)=>fn({})};
    const subject=isolatedBackend('api/database-migration.ts',{'../config':defaultMock({MEMPOOL:{NETWORK:'signet'},DATABASE:{DATABASE:'isolated'}}),'../database':defaultMock(db),'../logger':quietLogger}).default;
    return {subject,db,markers,statements,getVersion:()=>version,setFailure:(v:boolean)=>fail=v};
  }
  it('blocks startup on failed key migration without advancing the marker, then resumes',async()=>{
    const test=setup(103,true);await expect(test.subject.$initializeOrMigrateDatabase()).rejects.toThrow('step 104');expect(test.getVersion()).toBe(103);expect(test.markers).toEqual([]);
    test.setFailure(false);await expect(test.subject.$initializeOrMigrateDatabase()).resolves.toBeUndefined();expect(test.getVersion()).toBe(113);expect(test.markers).toEqual([104,105,106,107,108,109,110,111,112,113]);
  });
  it('blocks fresh startup if statistics index metadata cannot be read',async()=>{
    const test=setup(0);const query=test.db.query;
    test.db.query=async(sql:any)=>{if((typeof sql==='string'?sql:sql.sql).includes('SELECT COUNT(1) hasIndex'))throw Error('injected metadata failure');return query(sql);};
    await expect(test.subject.$initializeOrMigrateDatabase()).rejects.toThrow('step 1');expect(test.markers).toEqual([]);expect(test.getVersion()).toBe(0);
  });
  it('inspects and repairs a falsely advanced version before newer markers',async()=>{
    const test=setup(112,true);await expect(test.subject.$initializeOrMigrateDatabase()).rejects.toThrow();expect(test.markers).toEqual([]);
  });
  function interrupted29(malformed: 'none'|'column'|'key' = 'none') {
    const test=setup(28);test.subject.constructor.currentVersion=29;
    const query=test.db.query;
    const geo=[
      {COLUMN_NAME:'id',COLUMN_TYPE:'int unsigned',IS_NULLABLE:'NO',CHARACTER_SET_NAME:null},
      {COLUMN_NAME:'type',COLUMN_TYPE:"enum('city','country','division','continent')",IS_NULLABLE:'NO',CHARACTER_SET_NAME:'utf8mb3'},
      {COLUMN_NAME:'names',COLUMN_TYPE:malformed==='column'?'varchar(255)':'text',IS_NULLABLE:'YES',CHARACTER_SET_NAME:'utf8mb3'},
    ].map(column=>({...column,COLUMN_DEFAULT:null,EXTRA:''}));
    const keys=[{INDEX_NAME:'id',COLUMN_NAME:'id',SEQ_IN_INDEX:1,NON_UNIQUE:0,SUB_PART:null},
      {INDEX_NAME:'id',COLUMN_NAME:'type',SEQ_IN_INDEX:2,NON_UNIQUE:malformed==='key'?1:0,SUB_PART:null},
      {INDEX_NAME:'id_2',COLUMN_NAME:'id',SEQ_IN_INDEX:1,NON_UNIQUE:1,SUB_PART:null}];
    const nodes=new Map(['as_number','city_id'].map(name=>[name,{COLUMN_NAME:name,COLUMN_TYPE:'int unsigned',IS_NULLABLE:'YES',COLUMN_DEFAULT:null,EXTRA:''}]));
    test.db.query=async(input:any)=>{
      const sql=typeof input==='string'?input:input.sql;
      if(sql.includes("TABLE_NAME='geo_names'")&&sql.includes('information_schema.columns'))return [geo];
      if(sql.includes("TABLE_NAME='geo_names'")&&sql.includes('information_schema.statistics'))return [keys];
      if(sql.includes("TABLE_NAME='nodes'")&&sql.includes('information_schema.columns'))return [[...nodes.values()]];
      const add=sql.match(/^ALTER TABLE nodes ADD (\w+) (.+) NULL DEFAULT NULL$/);
      if(add) nodes.set(add[1],{COLUMN_NAME:add[1],COLUMN_TYPE:add[2].replace('(11)',''),IS_NULLABLE:'YES',COLUMN_DEFAULT:null,EXTRA:''});
      return query(input);
    };
    return test;
  }
  it('resumes a verified geo_names table and partly added nodes columns before marker29',async()=>{
    const test=interrupted29();await test.subject.$initializeOrMigrateDatabase();
    expect(test.getVersion()).toBe(29);expect(test.markers).toEqual([29]);
    expect(test.statements.some(sql=>sql.startsWith('CREATE TABLE geo_names'))).toBe(false);
    expect(test.statements.filter(sql=>sql.startsWith('ALTER TABLE nodes ADD')).length).toBe(5);
  });
  it.each(['column','key'] as const)('rejects an incompatible existing geo_names %s without advancing29',async(kind)=>{
    const test=interrupted29(kind);await expect(test.subject.$initializeOrMigrateDatabase()).rejects.toThrow('step 29');
    expect(test.getVersion()).toBe(28);expect(test.markers).toEqual([]);
    expect(test.statements.some(sql=>sql.startsWith('ALTER TABLE nodes ADD'))).toBe(false);
  });
  it.each([105,106,109,110,111])('advances monotonically from %i',async(version)=>{
    const test=setup(version);await test.subject.$initializeOrMigrateDatabase();expect(test.getVersion()).toBe(113);expect(test.markers).toEqual(Array.from({length:113-version},(_,i)=>version+i+1));
  });
  function interrupted47(existing: Record<string, unknown> | null = null) {
    const test=setup(46);test.subject.constructor.currentVersion=47;
    const query=test.db.query;let column=existing;let failMarker=false;
    const required={COLUMN_TYPE:'tinyint(1)',IS_NULLABLE:'YES',COLUMN_DEFAULT:'0',EXTRA:''};
    test.db.query=async(input:any)=>{
      const sql=typeof input==='string'?input:input.sql;
      if(sql.includes('information_schema.columns')&&sql.includes("COLUMN_NAME='cpfp_indexed'"))return [column?[column]:[]];
      if(sql==='ALTER TABLE `blocks` ADD cpfp_indexed tinyint(1) DEFAULT 0'){
        if(column)throw Error('Duplicate column cpfp_indexed');column=required;
      }
      if(failMarker&&sql.includes('UPDATE state SET number = 47'))throw Error('interrupted after committed DDL');
      return query(input);
    };
    return {...test,required,failMarker:(value:boolean)=>failMarker=value};
  }
  it('resumes step47 after the column DDL committed but the version marker did not',async()=>{
    const test=interrupted47();test.failMarker(true);
    await expect(test.subject.$initializeOrMigrateDatabase()).rejects.toThrow('step 47');
    expect(test.getVersion()).toBe(46);expect(test.markers).toEqual([]);
    test.failMarker(false);
    await expect(test.subject.$initializeOrMigrateDatabase()).resolves.toBeUndefined();
    expect(test.getVersion()).toBe(47);expect(test.markers).toEqual([47]);
    expect(test.statements.filter(sql=>sql==='ALTER TABLE `blocks` ADD cpfp_indexed tinyint(1) DEFAULT 0')).toHaveLength(1);
  });
  it.each([
    {COLUMN_TYPE:'varchar(1)',IS_NULLABLE:'YES',COLUMN_DEFAULT:'0',EXTRA:''},
    {COLUMN_TYPE:'tinyint unsigned',IS_NULLABLE:'YES',COLUMN_DEFAULT:'0',EXTRA:''},
    {COLUMN_TYPE:'tinyint',IS_NULLABLE:'NO',COLUMN_DEFAULT:'0',EXTRA:''},
    {COLUMN_TYPE:'tinyint',IS_NULLABLE:'YES',COLUMN_DEFAULT:'1',EXTRA:''},
    {COLUMN_TYPE:'tinyint',IS_NULLABLE:'YES',COLUMN_DEFAULT:'0',EXTRA:'VIRTUAL GENERATED'},
  ])('rejects incompatible step47 column before completing its marker (%j)',async(column)=>{
    const test=interrupted47(column);
    await expect(test.subject.$initializeOrMigrateDatabase()).rejects.toThrow('step 47');
    expect(test.getVersion()).toBe(46);expect(test.markers).toEqual([]);
    expect(test.statements.some(sql=>sql.startsWith('ALTER TABLE `blocks` ADD cpfp_indexed'))).toBe(false);
  });
});
