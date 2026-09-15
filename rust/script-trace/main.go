package main

import (
 "encoding/hex"
 "encoding/json"
 "fmt"
 "io"
 "os"
 "github.com/btcsuite/btcd/txscript"
 "github.com/btcsuite/btcd/wire"
)

type Input struct { Script string `json:"script_hex"`; Witness []string `json:"witness"` }
type Step struct { Step int `json:"step"`; Opcode string `json:"opcode"`; Before []string `json:"stack_before"`; After []string `json:"stack_after"`; Description string `json:"description"` }
type Result struct { Steps []Step `json:"steps"`; Count int `json:"count"`; Completed bool `json:"completed"`; Succeeded bool `json:"script_succeeded"`; Error string `json:"error,omitempty"`; Scope string `json:"scope"`; Engine string `json:"engine"` }
func strings(stack [][]byte) []string { result:=make([]string,len(stack));for i,v:=range stack {result[i]=hex.EncodeToString(v)};return result }
func trace(input Input) (Result,error) {
 r:=Result{Steps:[]Step{},Scope:"Standalone legacy script with supplied initial stack. No signatures, timelocks, P2SH/witness wrapping, transaction or consensus validation.",Engine:"btcd txscript 1c55c7c18179"}
 code,err:=hex.DecodeString(input.Script);if err!=nil||len(code)==0||len(code)>10000{return r,fmt.Errorf("invalid script encoding or size")}
 if txscript.IsPayToScriptHash(code)||txscript.IsWitnessProgram(code){return r,fmt.Errorf("output programs require transaction-context verification, not standalone stack execution")}
 tokenizer:=txscript.MakeScriptTokenizer(0,code)
 for tokenizer.Next(){switch tokenizer.Opcode(){case txscript.OP_CHECKSIG,txscript.OP_CHECKSIGVERIFY,txscript.OP_CHECKMULTISIG,txscript.OP_CHECKMULTISIGVERIFY,txscript.OP_CHECKSIGADD,txscript.OP_CHECKLOCKTIMEVERIFY,txscript.OP_CHECKSEQUENCEVERIFY:return r,fmt.Errorf("signature and timelock opcodes require transaction context")}}
 if tokenizer.Err()!=nil{return r,fmt.Errorf("malformed script")}
 if len(input.Witness)>100{return r,fmt.Errorf("initial stack exceeds 100 elements")};stack:=make([][]byte,len(input.Witness))
 for i,value:=range input.Witness {stack[i],err=hex.DecodeString(value);if err!=nil||len(stack[i])>520{return r,fmt.Errorf("invalid initial stack element")}}
 tx:=wire.NewMsgTx(2);tx.AddTxIn(&wire.TxIn{Sequence:wire.MaxTxInSequenceNum});tx.AddTxOut(&wire.TxOut{Value:0,PkScript:[]byte{txscript.OP_TRUE}})
 vm,err:=txscript.NewEngine(code,tx,0,txscript.ScriptVerifyMinimalData,nil,nil,0,nil);if err!=nil{return r,fmt.Errorf("script engine initialization failed")};vm.SetStack(stack)
 bytes:=0
 for i:=0;i<256;i++ {
  opcode,e:=vm.DisasmPC();if e!=nil{return r,fmt.Errorf("script disassembly failed")}
  before:=strings(vm.GetStack());done,e:=vm.Step();after:=strings(vm.GetStack());step:=Step{i,opcode,before,after,"Executed by the pinned standalone legacy script engine."}
  encoded,_:=json.Marshal(step);bytes+=len(encoded);if bytes>128*1024 {r.Error="trace size limit reached";return r,nil}
  r.Steps=append(r.Steps,step);r.Count=len(r.Steps)
  if e!=nil {r.Completed=true;r.Error=e.Error();return r,nil}
  if done {r.Completed=true;if e=vm.CheckErrorCondition(true);e!=nil {r.Error=e.Error()}else{r.Succeeded=true};return r,nil}
 }
 r.Error="trace step limit reached";return r,nil
}
func main(){if len(os.Args)>1&&os.Args[1]=="--transactions"{transactionMain();return};var input Input;if err:=json.NewDecoder(io.LimitReader(os.Stdin,65537)).Decode(&input);err!=nil{fmt.Println(`{"error":"invalid request"}`);os.Exit(2)};result,err:=trace(input);if err!=nil {json.NewEncoder(os.Stdout).Encode(map[string]string{"error":err.Error()});os.Exit(2)};json.NewEncoder(os.Stdout).Encode(result)}
