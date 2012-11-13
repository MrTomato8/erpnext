// ERPNext - web based ERP (http://erpnext.com)
// Copyright (C) 2012 Web Notes Technologies Pvt Ltd
// 
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

cur_frm.cscript.qty = function(doc, cdt, cdn) { cur_frm.cscript.recalc(doc, 1); }
	
cur_frm.cscript.discount = function(doc, cdt, cdn) { cur_frm.cscript.recalc(doc, 1); }

cur_frm.cscript.print_ref_rate = function(doc, cdt, cdn){
	var d = locals[cdt][cdn];
	var consider_incl_rate = cur_frm.cscript.consider_incl_rate(doc, cur_frm.cscript.other_fname);
	if(!consider_incl_rate) {
		set_multiple(cur_frm.cscript.tname, d.name, {'print_rate': flt(d.print_ref_rate) * (100 - flt(d.discount)) / 100}, cur_frm.cscript.fname);
	}
	cur_frm.cscript.recalc(doc, 1);
}

cur_frm.cscript.rate = function(doc, cdt, cdn) { 
	var fname = cur_frm.cscript.fname;
	var d = locals[cdt][cdn];
	if(!d.qty) {
		d.qty = 1;
		refresh_field('qty', d.name, fname);
	}
	var consider_incl_rate = cur_frm.cscript.consider_incl_rate(doc, cur_frm.cscript.other_fname);
	if(!consider_incl_rate) {
		cur_frm.cscript.recalc(doc, 2);
	} else {
		var rate = cur_frm.cscript.back_calc_rate(
			doc, cur_frm.cscript.tname, fname, d, cur_frm.cscript.other_fname
		);
		// TODO: remove wn.round for rate comparison
		if (d.rate != wn.round(rate, 2)) { 
			d.rate = rate;
			refresh_field('rate', d.name, fname); 
			msgprint("You cannot change Basic Rate* (Base Currency) when \
				considering rates inclusive of taxes.<br /> \
				Please either <br /> \
				* Specify Basic Rate (i.e. Rate which will be displayed in print) <br /> \
				-- or -- <br />\
				* Uncheck 'Is this Tax included in Basic Rate?' in the tax entries of Taxes section.");
		}
	}
}

cur_frm.cscript.print_rate = function(doc,cdt,cdn) {
	var cur_rec = locals[cdt][cdn];
	var fname = cur_frm.cscript.fname;
	var tname = cur_frm.cscript.tname;
	if(flt(cur_rec.print_ref_rate)>0 && flt(cur_rec.print_rate)>0) {
		var discount = 100 * (1 - (flt(cur_rec.print_rate) / flt(cur_rec.print_ref_rate)));
		set_multiple(tname, cur_rec.name, { 'discount': discount }, fname);
	}
	doc = locals[doc.doctype][doc.name];
	cur_frm.cscript.recalc(doc, 1);
}


cur_frm.cscript.recalc = function(doc, n) {
	if(!n)n=0;
	doc = locals[doc.doctype][doc.name];
	var tname = cur_frm.cscript.tname;
	var fname = cur_frm.cscript.fname;
	var sales_team = cur_frm.cscript.sales_team_fname;
	var other_fname	= cur_frm.cscript.other_fname;
	
	if(!flt(doc.exchange_rate)) { 
		doc.exchange_rate = 1; 
		refresh_field('exchange_rate'); 
	}
	if(!flt(doc.plc_exchange_rate)) { 
		doc.plc_exchange_rate = 1; 
		refresh_field('plc_exchange_rate'); 
	}

	if(n > 0) cur_frm.cscript.update_fname_table(doc , tname , fname , n, other_fname); // updates all values in table (i.e. amount, export amount, net total etc.)
	
	if(flt(doc.net_total) > 0) {
		var cl = getchildren('Sales Taxes and Charges', doc.name, other_fname,doc.doctype);
		for(var i = 0; i<cl.length; i++){
			cl[i].total_tax_amount = 0;
			cl[i].total_amount = 0;
			cl[i].tax_amount = 0;										// this is done to calculate other charges
			cl[i].total = 0;
			cl[i].item_wise_tax_detail = "";
			if(in_list(['On Previous Row Amount','On Previous Row Total'],cl[i].charge_type) && !cl[i].row_id){
				alert("Please Enter Row on which amount needs to be calculated for row : "+cl[i].idx);
				validated = false;
			}
		}
		cur_frm.cscript.calc_taxes_and_charges(doc , tname , fname , other_fname); // calculate other charges
	}
	cur_frm.cscript.calc_doc_values(doc, null, null, tname, fname, other_fname); // calculates total amounts

	cl = getchildren('Sales Team', doc.name, sales_team);
	for(var i=0;i<cl.length;i++) {
		if (cl[i].allocated_percentage) {
			cl[i].allocated_amount = flt(flt(doc.net_total)*flt(cl[i].allocated_percentage)/100);
			refresh_field('allocated_amount', cl[i].name, sales_team);
		}
	}
	doc.rounded_total_in_words = '';
	doc.rounded_total_in_words_print = '';
	refresh_many(['total_discount','total_discount','net_total','total_commission','grand_total','rounded_total','grand_total_print','rounded_total_print','rounded_total_in_words','rounded_total_in_words_print','taxes_and_charges','taxes_and_charges_total']);
	if(cur_frm.cscript.custom_recalc)cur_frm.cscript.custom_recalc(doc);
}

cur_frm.cscript.calc_doc_values = function(doc, cdt, cdn, tname, fname, other_fname) {
	doc = locals[doc.doctype][doc.name];
	var net_total = 0; var taxes_and_charges_total = 0;
	var net_total_incl = 0
	var cl = getchildren(tname, doc.name, fname);
	for(var i = 0; i<cl.length; i++){
		//net_total += flt(cl[i].rate) * flt(cl[i].qty);
		net_total += flt(cl[i].amount);
		net_total_incl += flt(cl[i].print_amount);
	}

	var inclusive_rate = 0
	var d = getchildren('Sales Taxes and Charges', doc.name, other_fname,doc.doctype);
	for(var j = 0; j<d.length; j++){
		taxes_and_charges_total += flt(d[j].tax_amount);
		if(d[j].included_in_print_rate) {
			inclusive_rate = 1;
		}
	}

	if(flt(doc.exchange_rate)>1) {
		net_total_incl *= flt(doc.exchange_rate);
	}

	doc.net_total = inclusive_rate ? flt(net_total_incl) : flt(net_total);
	doc.taxes_and_charges_total = wn.round(flt(taxes_and_charges_total), 2);
	doc.grand_total = wn.round((flt(net_total) + flt(taxes_and_charges_total)), 2);
	doc.rounded_total = Math.round(doc.grand_total);
	doc.grand_total_print = wn.round((flt(doc.grand_total) / flt(doc.exchange_rate)), 2);
	doc.rounded_total_print = Math.round(doc.grand_total_print);
	doc.total_commission = flt(flt(net_total) * flt(doc.commission_rate) / 100);
}

cur_frm.cscript.calc_other_charges = function(doc , tname , fname , other_fname) {
	doc = locals[doc.doctype][doc.name];

	// Make Display Area
	cur_frm.fields_dict['tax_calculation'].disp_area.innerHTML =
		'<b style="padding: 8px 0px;">Calculation Details for Taxes and Charges:</b>';

	var cl = getchildren(tname, doc.name, fname);
	var tax = getchildren('Sales Taxes and Charges', doc.name, other_fname,doc.doctype);
	
	// Make display table
	var otc = make_table(cur_frm.fields_dict['tax_calculation'].disp_area,
		cl.length + 1, tax.length + 1, '90%', [], { border:'1px solid #AAA', padding:'2px' });
	$y(otc,{marginTop:'8px'});

	var tax_desc = {}; var tax_desc_rates = []; var net_total = 0;
	
	for(var i=0;i<cl.length;i++) {
		net_total += flt(flt(cl[i].qty) * flt(cl[i].rate));
		var prev_total = flt(cl[i].amount);
		if(cl[i].item_tax_rate) {
			try {
				var check_tax = JSON.parse(cl[i].item_tax_rate);				//to get in dictionary
			} catch(exception) {
				var check_tax = eval('var a='+cl[i].item_tax_rate+';a');        //to get in dictionary
			}
		}
		
		// Add Item Code in new Row
		$td(otc,i+1,0).innerHTML = cl[i].item_code ? cl[i].item_code : cl[i].description;
		
		//var tax = getchildren('Sales Taxes and Charges', doc.name, other_fname,doc.doctype);
		var total = net_total;
		
		
		for(var t=0;t<tax.length;t++){
			var account = tax[t].account_head;
			$td(otc,0,t+1).innerHTML = account?account:'';
			//Check For Rate
			if(cl[i].item_tax_rate && check_tax[account]!=null) {
				var rate = flt(check_tax[account]);
			} else {
				// if particular item doesn't have particular rate it will take other charges rate
				var rate = flt(tax[t].rate);
			}

			//Check For Rate and get tax amount
			var tax_amount = cur_frm.cscript.check_charge_type_and_get_tax_amount(doc,tax,t, cl[i], rate);
			
			//enter item_wise_tax_detail i.e. tax rate on each item
			var item_wise_tax_detail = cur_frm.cscript.get_item_wise_tax_detail(doc, rate, cl, i, tax, t);
			if(tax[t].charge_type != "Actual") tax[t].item_wise_tax_detail += item_wise_tax_detail;
			tax[t].total_amount = flt(tax_amount);		 //stores actual tax amount in virtual field
			tax[t].total_tax_amount = flt(prev_total);			//stores total amount in virtual field
			tax[t].tax_amount += flt(tax_amount);			 
			var total_amount = flt(tax[t].tax_amount);
			total_tax_amount = flt(tax[t].total_tax_amount) + flt(total_amount);
			set_multiple('Sales Taxes and Charges', tax[t].name, { 'item_wise_tax_detail':tax[t].item_wise_tax_detail, 'amount':wn.round(flt(total_amount), 2), 'total':wn.round(flt(total)+flt(tax[t].tax_amount), 2)}, other_fname);
			prev_total += flt(tax[t].total_amount);	 // for previous row total
			total += flt(tax[t].tax_amount);		 // for adding total to previous amount

			if(tax[t].charge_type == 'Actual')
				$td(otc,i+1,t+1).innerHTML = fmt_money(tax[t].total_amount);
			else
				$td(otc,i+1,t+1).innerHTML = '('+fmt_money(rate) + '%) ' +fmt_money(tax[t].total_amount);

		}
	}
	
	for(var t=0;t<tax.length;t++){
		tax[t].tax_amount = wn.round(tax[t].tax_amount, 2);
	}
}
cur_frm.cscript.check_charge_type_and_get_tax_amount = function( doc, tax, t, cl, rate, print_amt) {
	doc = locals[doc.doctype][doc.name];
	if (! print_amt) print_amt = 0;
	var tax_amount = 0;
	if(tax[t].charge_type == 'Actual') {
		var value = flt(tax[t].rate) / flt(doc.net_total);	 // this give the ratio in which all items are divided					 
		return tax_amount = flt(value) * flt(cl.amount);
	 }	 
	else if(tax[t].charge_type == 'On Net Total') {
		if (flt(print_amt) == 1) {
			doc.excise_rate = flt(rate);
			doc.total_excise_rate += flt(rate);
			refresh_field('excise_rate');
			refresh_field('total_excise_rate');
			return
		}
	return tax_amount = (flt(rate) * flt(cl.amount) / 100);
	}
	else if(tax[t].charge_type == 'On Previous Row Amount'){
		if(flt(print_amt) == 1) {
			doc.total_excise_rate += flt(flt(doc.excise_rate) * 0.01 * flt(rate));
			refresh_field('total_excise_rate');
			return
		}
		var row_no = (tax[t].row_id).toString();
		var row = (row_no).split("+");			// splits the values and stores in an array
		for(var r = 0;r<row.length;r++){
			var id = cint(row[r].replace(/^\s+|\s+$/g,""));
			tax_amount += (flt(rate) * flt(tax[id-1].total_amount) / 100);
		}
		var row_id = row_no.indexOf("/");
		if(row_id != -1) {
			rate = '';
			var row = (row_no).split("/");			// splits the values and stores in an array
			if(row.length>2) alert("You cannot enter more than 2 nos. for division");
			var id1 = cint(row[0].replace(/^\s+|\s+$/g,""));
			var id2 = cint(row[1].replace(/^\s+|\s+$/g,""));
			tax_amount = flt(tax[id1-1].total_amount) / flt(tax[id2-1].total_amount);
		}
		return tax_amount
	}
	else if(tax[t].charge_type == 'On Previous Row Total') {
		if(flt(print_amt) == 1) {
			doc.sales_tax_rate += flt(rate);
			refresh_field('sales_tax_rate');
			return
		}
		var row = cint(tax[t].row_id);
		return tax_amount = flt(rate) * (flt(tax[row-1].total_tax_amount)+flt(tax[row-1].total_amount)) / 100;
	}
}

cur_frm.cscript.consider_incl_rate = function(doc, other_fname) {
	var tax_list = getchildren('Sales Taxes and Charges', doc.name, other_fname, doc.doctype);
	for(var i=0; i<tax_list.length; i++) {
		if(tax_list[i].included_in_print_rate) {
			return true;
		}
	}
	return false;
}

cur_frm.cscript.back_calc_rate = function(doc, tname, fname, child, other_fname) {	
	var get_item_tax_rate = function(item, tax) {
		if(item.item_tax_rate) {
			try {
				var item_tax = JSON.parse(item.item_tax_rate);
			} catch(exception) {
				var item_tax = eval('var a='+item.item_tax_rate+';a');
			}
			if(item_tax[tax.account_head]!=null) {
				return flt(item_tax[tax.account_head]);
			}
		}
	};

	var tax_list = getchildren('Sales Taxes and Charges', doc.name, other_fname, doc.doctype);
	var total = 1;
	var temp_tax_list = [];
	var amt = 0;
	var item_tax_rate = 0;
	var rate = 0;
	for(var i=0; i<tax_list.length; i++) {
		amt = 0;
		item_tax_rate = get_item_tax_rate(child, tax_list[i]);
		rate = item_tax_rate ? item_tax_rate : flt(tax_list[i].rate);
		if(tax_list[i].included_in_print_rate) {
			if(tax_list[i].charge_type=='On Net Total') {
				amt = flt(rate / 100);
			} else if(tax_list[i].charge_type=='On Previous Row Total') {
				amt = flt((rate * temp_tax_list[tax_list[i].row_id-1]['total']) / 100);
			} else if(tax_list[i].charge_type=='On Previous Row Amount') {
				amt = flt((rate * temp_tax_list[tax_list[i].row_id-1]['amt']) / 100);
			}
		}
		total += flt(amt);
		temp_tax_list[i] = {
			amt: amt,
			total: total
		};
	}
	var rate = (child.print_rate * flt(doc.exchange_rate)) / total;
	return rate;
}

cur_frm.cscript.included_in_print_rate = function(doc, cdt, cdn) {
	var tax = locals[cdt][cdn];
	if(tax.included_in_print_rate==1) { 
		if(!inList(['On Net Total', 'On Previous Row Total', 'On Previous Row Amount'], tax.charge_type)) {
			msgprint("'Is this Tax included in Basic Rate?' (i.e. Inclusive Price) is only valid for charges of type: <br /> \
				* On Net Total <br /> \
				* On Previous Row Amount <br /> \
				* On Previous Row Total");
			tax.included_in_print_rate = 0;
			refresh_field('included_in_print_rate', tax.name, cur_frm.cscript.other_fname);
		} 
		var tax_list = getchildren('Sales Taxes and Charges', doc.name, cur_frm.cscript.other_fname, doc.doctype);
		cur_frm.cscript.validate_print_rate_option(doc, tax_list, tax.idx-1);
	}
}


cur_frm.cscript.update_fname_table = function(doc , tname , fname , n, other_fname) {
	doc = locals[doc.doctype][doc.name] 
	var net_total = 0
	var cl = getchildren(tname, doc.name, fname);
	var consider_incl_rate = cur_frm.cscript.consider_incl_rate(doc, other_fname);
	for(var i=0;i<cl.length;i++) {
		if(n == 1){
			if(!consider_incl_rate) {
				if(flt(cl[i].print_ref_rate) > 0) {
					set_multiple(tname, cl[i].name, {
						'print_rate': flt(flt(cl[i].print_ref_rate) * (100 - flt(cl[i].discount)) / 100)
					}, fname);
				}
				set_multiple(tname, cl[i].name, {
					'print_amount': flt(flt(cl[i].qty) * flt(cl[i].print_rate)),
					'rate': flt(flt(cl[i].print_rate) * flt(doc.exchange_rate)),
					'amount': wn.round(flt((flt(cl[i].print_rate) * flt(doc.exchange_rate)) * flt(cl[i].qty)), 2)
				}, fname);
			
		} else if(consider_incl_rate) {
			if(flt(cl[i].print_rate) > 0) {
				// calculate basic rate based on taxes
				// then calculate and set rate, ref_rate, print_ref_rate, amount, print_amount
				var print_ref_rate = flt(cl[i].discount)!=flt(100) ?
					flt((100 * flt(cl[i].print_rate))/flt(100 - flt(cl[i].discount))) :
					flt(0)
				set_multiple(tname, cl[i].name, { 'print_ref_rate': print_ref_rate }, fname);
			} else if((flt(cl[i].print_ref_rate) > 0) && (flt(cl[i].discount) > 0)) {
				var print_rate = flt(cl[i].print_ref_rate) * flt(1 - flt(cl[i].discount / 100));
				set_multiple(tname, cl[i].name, { 'print_rate': flt(print_rate) }, fname);
			}
			//console.log("print_rate: " + cl[i].print_rate);

			var rate = cur_frm.cscript.back_calc_rate(doc, tname, fname, cl[i], other_fname);
			var ref_rate = rate + flt(rate * flt(cl[i].discount) / 100);
			set_multiple(tname, cl[i].name, {
				'rate': flt(rate),
				'amount': wn.round(flt(rate * flt(cl[i].qty)), 2),
				'print_amount': flt(flt(cl[i].qty) * flt(cl[i].print_rate)),
				'ref_rate': flt(ref_rate)
			}, fname);
		}
		}
		else if(n == 2){
			if(flt(cl[i].print_ref_rate) > 0)
				set_multiple(tname, cl[i].name, {'discount': 100 - flt(flt(cl[i].rate)	* 100 / (flt(cl[i].print_ref_rate) * flt(doc.exchange_rate)))}, fname);
			set_multiple(tname, cl[i].name, {'amount': flt(flt(cl[i].qty) * flt(cl[i].rate)), 'print_rate': flt(flt(cl[i].rate) / flt(doc.exchange_rate)), 'print_amount': flt((flt(cl[i].rate) / flt(doc.exchange_rate)) * flt(cl[i].qty)) }, fname);
		}
		
		net_total += flt(flt(cl[i].qty) * flt(cl[i].rate));
	}
	doc.net_total = net_total;
	refresh_field('net_total');
}

cur_frm.cscript.get_item_wise_tax_detail = function( doc, rate, cl, i, tax, t) {
	doc = locals[doc.doctype][doc.name];
	var detail = '';
	detail = cl[i].item_code + " : " + cstr(rate) + NEWLINE;
	return detail;
}

cur_frm.cscript.calculate_taxes_and_totals = function(doc, cdt, cdn) {	
	cur_frm.cscript.calculate_charges(doc,cdt,cdn);
}

cur_frm.cscript.validate_print_rate_option = function(doc, taxes, i) {
	if(in_list(['On Previous Row Amount','On Previous Row Total'], taxes[i].charge_type)) { 
		if(!taxes[i].row_id){
			alert("Please Enter Row on which amount needs to be calculated for row : "+taxes[i].idx);
			validated = false;
		} else if(taxes[i].included_in_print_rate && taxes[taxes[i].row_id-1].charge_type=='Actual') {
			msgprint("Row of type 'Actual' cannot be depended on for type '" + taxes[i].charge_type + "'\
				when using tax inclusive prices.<br />\
				This will lead to incorrect values.<br /><br /> \
				<b>Please specify correct value in 'Enter Row' column of <span style='color:red'>Row: "	
				+ taxes[i].idx + "</span> in Taxes table</b>");
			validated = false;
			taxes[i].included_in_print_rate = 0;
			refresh_field('included_in_print_rate', taxes[i].name, other_fname);
		} else if ((taxes[i].included_in_print_rate && !taxes[taxes[i].row_id-1].included_in_print_rate) || 
			(!taxes[i].included_in_print_rate && taxes[taxes[i].row_id-1].included_in_print_rate)) {
			msgprint("If any row in the tax table depends on 'Previous Row Amount/Total', <br />\
				'Is this Tax included in Basic Rate?' column should be same for both row <br />\
				i.e for that row and the previous row. <br /><br />\
				The same is violated for row #"+(i+1)+" and row #"+taxes[i].row_id
			);
			validated = false;
		}		
	}
}

cur_frm.cscript.calculate_charges = function(doc, cdt, cdn) {
	var other_fname	= cur_frm.cscript.other_fname;

	var cl = getchildren('Sales Taxes and Charges', doc.name, other_fname, doc.doctype);
	for(var i = 0; i<cl.length; i++){
		cl[i].total_tax_amount = 0;
		cl[i].total_amount = 0;
		cl[i].tax_amount = 0;										// this is done to calculate other charges
		cl[i].total = 0;
		cur_frm.cscript.validate_print_rate_option(doc, cl, i);
	}
	cur_frm.cscript.recalc(doc, 1);
}

cur_frm.cscript.validate = function(doc, cdt, cdn) {
	cur_frm.cscript.calculate_charges (doc, cdt, cdn);
	if (cur_frm.cscript.calc_adjustment_amount) cur_frm.cscript.calc_adjustment_amount(doc);
}
