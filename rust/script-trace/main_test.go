package main
import "testing"
func TestActualStack(t *testing.T){r,e:=trace(Input{Script:"51935287",Witness:[]string{"01"}});if e!=nil||!r.Succeeded||r.Count!=4{t.Fatalf("unexpected result: %+v %v",r,e)};if r.Steps[1].After[0]!="02"{t.Fatal("OP_ADD did not execute")}}
func TestFalseAndContext(t *testing.T){r,e:=trace(Input{Script:"0069"});if e!=nil||r.Succeeded||r.Error==""{t.Fatal("false script did not fail")};for _,s:=range []string{"ac","b2","00140000000000000000000000000000000000000000"}{if _,e=trace(Input{Script:s});e==nil{t.Fatal("contextual program accepted")}}}
